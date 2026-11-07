import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { db } from "@/src/lib/database/client";
import { resetConfigForTests } from "@/src/lib/config";
import { setProviderForTests, type LLMProvider, type Turn } from "@/src/lib/ai";
import { getSwitch } from "@/src/lib/switch";
import type { SimulatedSwitchBackend } from "@/src/lib/switch/simulator";
import { runCommand } from "@/src/lib/execution/runner";
import { ensureRuntime } from "@/src/orchestration/runtime";
import { cancelIncident, handleHandoff } from "@/src/orchestration/workflow";
import { createPullRequest } from "@/src/orchestration/approval";
import { connectGitHubRepository } from "@/src/services/repositories";
import { saveGitHubToken } from "@/src/lib/github/tokens";
import { createIncident } from "@/src/services/incidents";
import { demoBrains, ScriptedProvider } from "../helpers/scripted-provider";
import { makeUser, resetDb, waitFor, waitForStatus } from "../helpers/fixtures";

const report = { title: "Registration endpoint returns HTTP 500", description: "Users cannot complete registration. The endpoint returns a server error instead of creating an account.", autoStart: true };
const happy = new ScriptedProvider(demoBrains);

/** A model that never answers until aborted (hung provider). */
function hangingFor(role: string): LLMProvider {
  return {
    name: "hang",
    availability: () => ({ ok: true }),
    startConversation(opts) {
      if (!opts.system.includes(`You are PATCHWORK_${role}`)) return happy.startConversation(opts);
      return {
        next: (signal?: AbortSignal) => new Promise<Turn>((_r, reject) => signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")))),
        addToolResults() {},
        addUserText() {},
      };
    },
  };
}

describe("failure handling", () => {
  beforeAll(async () => {
    await resetDb();
    setProviderForTests(happy);
    await ensureRuntime();
  });
  afterEach(() => {
    setProviderForTests(happy);
    delete process.env.AGENT_TIMEOUT_MS;
    delete process.env.EXECUTION_TIMEOUT_MS;
    resetConfigForTests();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await getSwitch().stop();
  });

  it("fails an incident whose agent times out, keeping earlier findings", async () => {
    process.env.AGENT_TIMEOUT_MS = "1500";
    resetConfigForTests();
    setProviderForTests(hangingFor("Investigator"));
    const { user, workspace, repo } = await makeUser("timeout@example.com", "Tim Out");
    const inc = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const failed = await waitForStatus(inc.id, ["FAILED"], 20_000);
    expect(failed.lastError).toMatch(/\[investigation\] Agent timed out/);
    expect(failed.severity).toBe("HIGH"); // triage result preserved
    expect(await db.agentTask.count({ where: { incidentId: inc.id, stage: "triage", status: "COMPLETED" } })).toBe(1);
  });

  it("fails cleanly when the model keeps returning invalid reports", async () => {
    setProviderForTests(new ScriptedProvider({ ...demoBrains, TRIAGE: () => ({ tool: "submit_report", input: { severity: "URGENT" } }) }));
    const { user, workspace, repo } = await makeUser("invalid@example.com", "In Valid");
    const inc = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const failed = await waitForStatus(inc.id, ["FAILED"], 20_000);
    expect(failed.lastError).toMatch(/Invalid agent response: PATCHWORK_Triage submitted 4 invalid reports/);
    expect(failed.severity).toBeNull(); // nothing invented
  });

  it("reports the AI provider as unavailable instead of producing results", async () => {
    setProviderForTests({ name: "none", availability: () => ({ ok: false, reason: "ANTHROPIC_API_KEY is not set." }), startConversation: () => { throw new Error("unreachable"); } });
    const { user, workspace, repo } = await makeUser("noai@example.com", "No Ai");
    const inc = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const failed = await waitForStatus(inc.id, ["FAILED"], 20_000);
    expect(failed.lastError).toMatch(/AI provider unavailable: ANTHROPIC_API_KEY is not set/);
    expect(await db.evidence.count({ where: { incidentId: inc.id, agentId: { not: null } } })).toBe(0);
  });

  it("cancels a running investigation without marking it failed", async () => {
    setProviderForTests(hangingFor("Investigator"));
    const { user, workspace, repo } = await makeUser("cancel@example.com", "Can Cel");
    const inc = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    await waitFor(() => db.agentTask.findFirst({ where: { incidentId: inc.id, stage: "investigation", status: "RUNNING" } }), { label: "investigation running" });
    expect(await cancelIncident(inc.id, { id: user.id, name: user.name })).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    const after = await db.incident.findUniqueOrThrow({ where: { id: inc.id } });
    expect(after.status).toBe("CANCELLED");
    expect(await db.agentTask.count({ where: { incidentId: inc.id, status: "RUNNING" } })).toBe(0);
  });

  it("retries Switch message delivery after transient failures", async () => {
    const sim = getSwitch().backend as SimulatedSwitchBackend;
    sim.failNextPosts = 2;
    const { user, workspace, repo } = await makeUser("flaky@example.com", "Fla Ky");
    const inc = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const done = await waitForStatus(inc.id, ["AWAITING_APPROVAL", "FAILED", "BLOCKED"], 60_000);
    expect(done.status).toBe("AWAITING_APPROVAL");
    const first = await db.agentMessage.findFirstOrThrow({ where: { incidentId: inc.id }, orderBy: { createdAt: "asc" } });
    expect((first.metadata as { switch: { deliveryAttempts: number } }).switch.deliveryAttempts).toBe(3);
  });

  it("redelivers a handoff an agent never received (dropped event), then continues", async () => {
    const sw = getSwitch();
    let dropped = false;
    sw.onHandoff(async (h) => {
      if (!dropped && h.handoff.kind === "investigate") {
        dropped = true; // simulate a lost delivery to the Investigator
        return;
      }
      await handleHandoff(h);
    });
    const { user, workspace, repo } = await makeUser("drop@example.com", "Dro Pped");
    const inc = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const done = await waitForStatus(inc.id, ["AWAITING_APPROVAL", "FAILED", "BLOCKED"], 60_000);
    sw.onHandoff((h) => handleHandoff(h));
    expect(done.status).toBe("AWAITING_APPROVAL");
    const errs = await db.activityEvent.findMany({ where: { incidentId: inc.id, eventType: "WORKFLOW_ERROR" } });
    expect(errs.some((e) => /redelivering via Switch/.test(e.description))).toBe(true);
  });

  it("terminates a test command that exceeds its timeout", async () => {
    process.env.EXECUTION_TIMEOUT_MS = "1500";
    resetConfigForTests();
    const dir = mkdtempSync(path.join(os.tmpdir(), "pw-slow-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "slow", scripts: { test: "node -e \"setTimeout(() => {}, 60000)\"" } }));
    const started = Date.now();
    const r = await runCommand(dir, "npm test");
    expect(r.status).toBe("TIMED_OUT");
    expect(r.stderr).toMatch(/exceeded 1500ms and was terminated/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("reports GitHub permission failures clearly", async () => {
    const { user, workspace } = await makeUser("gh@example.com", "Git Hub");
    await saveGitHubToken(user.id, "ghp_testtokenvalue1234567890abcdef", "octo");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: "Resource not accessible by personal access token" }), { status: 403 }));
    await expect(connectGitHubRepository(user, workspace.id, "octo/private")).rejects.toThrow(/403 \(token lacks permission or rate limited\)/);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: 1, name: "ro", full_name: "octo/ro", owner: { login: "octo" }, default_branch: "main", private: true, description: null, html_url: "https://github.com/octo/ro", permissions: { pull: false } }), { status: 200 }));
    await expect(connectGitHubRepository(user, workspace.id, "octo/ro")).rejects.toThrow(/cannot read this repository/);
  });

  it("keeps an approved fix APPROVED (not RESOLVED) when the pull request cannot be created", async () => {
    const { user, workspace } = await makeUser("pr@example.com", "Pee Ar");
    await saveGitHubToken(user.id, "ghp_testtokenvalue1234567890abcdef", "octo");
    const repo = await db.repository.create({ data: { workspaceId: workspace.id, provider: "GITHUB", owner: "octo", name: "app", fullName: "octo/app", defaultBranch: "main", visibility: "private" } });
    const ws = mkdtempSync(path.join(os.tmpdir(), "pw-noremote-"));
    const inc = await db.incident.create({ data: { workspaceId: workspace.id, repositoryId: repo.id, title: "t", description: "d", status: "APPROVED", workingBranch: "patchwork/incident-x-fix", workspacePath: ws } });
    await expect(createPullRequest(inc.id, { id: user.id, name: user.name })).rejects.toThrow(/Pull request creation failed/);
    const after = await db.incident.findUniqueOrThrow({ where: { id: inc.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.pullRequestUrl).toBeNull();
    expect(after.lastError).toMatch(/Pull request creation failed/);
  });
});
