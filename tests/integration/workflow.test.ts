import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/src/lib/database/client";
import { setProviderForTests } from "@/src/lib/ai";
import { getSwitch } from "@/src/lib/switch";
import { ensureRuntime } from "@/src/orchestration/runtime";
import { approveFix, rejectFix } from "@/src/orchestration/approval";
import { postHumanMessage } from "@/src/orchestration/workflow";
import { createIncident } from "@/src/services/incidents";
import { demoBrains, ScriptedProvider } from "../helpers/scripted-provider";
import { makeUser, resetDb, waitFor, waitForStatus } from "../helpers/fixtures";
import { git } from "@/src/lib/execution/git";

const report = {
  title: "Registration endpoint returns HTTP 500",
  description: "Users cannot complete registration. The endpoint returns a server error instead of creating an account. Please investigate and fix the problem.",
  autoStart: true,
};

describe("full incident workflow over Switch (simulator) with real repository operations", () => {
  let provider: ScriptedProvider;
  beforeAll(async () => {
    await resetDb();
    provider = new ScriptedProvider(demoBrains);
    setProviderForTests(provider);
    await ensureRuntime();
  });
  beforeEach(() => {
    provider.calls.length = 0;
    setProviderForTests(provider);
  });
  afterAll(async () => {
    await getSwitch().stop();
  });

  it("takes the demo bug from report to a verified fix awaiting approval, including a QA failure loop", async () => {
    const { user, workspace, repo } = await makeUser();
    const incident = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const done = await waitForStatus(incident.id, ["AWAITING_APPROVAL", "FAILED", "BLOCKED"], 60_000);
    if (done.status !== "AWAITING_APPROVAL") throw new Error(`Workflow ended ${done.status}: ${done.lastError}`);
    await waitFor(() => db.activityEvent.findFirst({ where: { incidentId: incident.id, eventType: "APPROVAL_REQUESTED" } }), { label: "approval request" });

    // Switch room was created and every handoff travelled through it.
    expect(done.switchRoomId).toBeTruthy();
    expect(done.switchMode).toBe("simulator");
    const events = await db.activityEvent.findMany({ where: { incidentId: incident.id }, orderBy: { seq: "asc" } });
    const types = events.map((e) => e.eventType);
    for (const t of ["INCIDENT_CREATED", "SWITCH_ROOM_CREATED", "AGENT_JOINED_ROOM", "TRIAGE_STARTED", "TRIAGE_COMPLETED", "INVESTIGATION_COMPLETED", "FIX_STARTED", "CODE_CHANGED", "QA_STARTED", "TEST_COMPLETED", "FIX_FAILED", "FIX_PASSED", "APPROVAL_REQUESTED"]) expect(types).toContain(t);
    const deliveries = events.filter((e) => e.eventType === "SWITCH_HANDOFF_DELIVERED").map((e) => (e.metadata as { kind: string }).kind);
    expect(deliveries).toEqual(["incident.opened", "investigate", "fix", "verify", "fix", "verify", "qa.passed"]);

    // Severity from triage.
    expect(done.severity).toBe("HIGH");

    // Two fix attempts; the first failed real tests, the second passed them.
    expect(done.fixAttempts).toBe(2);
    const testRuns = await db.testRun.findMany({ where: { incidentId: incident.id }, orderBy: { startedAt: "asc" } });
    expect(testRuns.map((t) => [t.agentId, t.attempt, t.status])).toEqual([
      ["agent_investigator", 1, "FAILED"],
      ["agent_qa", 1, "FAILED"],
      ["agent_qa", 2, "PASSED"],
    ]);
    expect(testRuns[0].output + testRuns[0].errorOutput).toContain("reading 'displayName'");
    expect(testRuns[2].output).toMatch(/# pass 8/);

    // Evidence: real references verified, the fabricated one contradicted.
    const evidence = await db.evidence.findMany({ where: { incidentId: incident.id } });
    const byTitle = (t: string) => evidence.find((e) => e.title === t);
    expect(byTitle("Response reads profile.displayName")?.verificationStatus).toBe("VERIFIED");
    expect(byTitle("createUser omits profile")?.verificationStatus).toBe("VERIFIED");
    expect(byTitle("Registration tests fail")?.verificationStatus).toBe("VERIFIED");
    expect(byTitle("Fabricated reference")?.verificationStatus).toBe("CONTRADICTED");
    expect(byTitle("Initial hypothesis (to be tested)")?.verificationStatus).toBe("UNVERIFIED");
    // Attempt 2 reverted register.js; that is not a false claim about its own commit.
    expect(evidence.find((e) => e.title.startsWith("Fixer described changes"))).toBeUndefined();
    // QA attempt-1 test evidence is superseded by attempt 2.
    expect(evidence.filter((e) => e.type === "TEST_RESULT" && e.agentId === "agent_qa" && e.attempt === 1).every((e) => e.verificationStatus === "SUPERSEDED")).toBe(true);

    // Code changes captured from git on the isolated branch.
    const changes = await db.codeChange.findMany({ where: { incidentId: incident.id, attempt: 2 } });
    expect(changes.map((c) => c.filePath).sort()).toEqual(["src/users/store.js"]);
    expect(changes[0].diff).toContain("+      profile: { displayName: defaultDisplayName(email, name)");
    const branch = (await git(done.workspacePath!, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    expect(branch).toBe(`patchwork/incident-${done.number}-fix`);
    const mainLog = (await git(done.workspacePath!, ["log", "--oneline", "main"])).stdout.trim().split("\n");
    expect(mainLog).toHaveLength(1); // default branch untouched

    // Messages are persisted and confirmed delivered back through the room.
    const messages = await db.agentMessage.findMany({ where: { incidentId: incident.id } });
    const handoffs = messages.filter((m) => (m.metadata as { handoff?: unknown }).handoff);
    expect(handoffs.length).toBeGreaterThanOrEqual(7);
    expect(handoffs.every((m) => (m.metadata as { switch: { delivered: boolean } }).switch.delivered)).toBe(true);

    // Each agent used its configured model.
    expect(new Set(provider.calls.filter((c) => c.role === "TRIAGE").map((c) => c.model))).toEqual(new Set(["claude-haiku-5-5"]));

    // Human message is relayed through Switch and answered by the addressed agent.
    await postHumanMessage(incident.id, { id: user.id, name: user.name }, "Do not modify the API response format.", "TRIAGE");
    await waitFor(() => db.agentMessage.findFirst({ where: { incidentId: incident.id, messageType: "CHAT" } }), { label: "consult reply" });
    const human = await db.agentMessage.findFirstOrThrow({ where: { incidentId: incident.id, senderType: "HUMAN" } });
    expect(human.content).toBe("Do not modify the API response format.");

    // Approval: local repository → branch preserved, resolved, never merged.
    const approved = await approveFix(incident.id, { id: user.id, name: user.name }, { createPullRequest: true });
    expect(approved.status).toBe("RESOLVED");
    expect(approved.resolvedAt).toBeTruthy();
    expect(await db.approval.count({ where: { incidentId: incident.id, decision: "APPROVED" } })).toBe(1);
  });

  it("enforces the retry limit and blocks after repeated QA failures", async () => {
    const { user, workspace, repo } = await makeUser("blocked@example.com", "Bo Locked");
    // Fixer keeps applying only the naive patch, so QA keeps failing.
    setProviderForTests(new ScriptedProvider({ ...demoBrains, FIXER: (s) => (s.turn === 1 ? { tool: "write_file", input: { path: "NOTES.md", content: `attempt marker ${Date.now()}\n` } } : { tool: "submit_report", input: { rootCauseAddressed: "Tried something", filesModified: [{ path: "NOTES.md", description: "notes" }], summary: "Wrote notes only.", whyItWorks: "It does not.", potentialSideEffects: [], testsToRun: ["npm test"] } }) }));
    const incident = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const done = await waitForStatus(incident.id, ["BLOCKED", "FAILED", "AWAITING_APPROVAL"], 60_000);
    expect(done.status).toBe("BLOCKED");
    expect(done.fixAttempts).toBe(3);
    expect(await db.agentTask.count({ where: { incidentId: incident.id, stage: "qa", status: "COMPLETED" } })).toBe(3);
    expect(done.lastError).toMatch(/repair limit/);
    setProviderForTests(provider);
  });

  it("refuses a PASS verdict when QA executed no tests", async () => {
    const { user, workspace, repo } = await makeUser("lazy@example.com", "Lazy QA");
    setProviderForTests(new ScriptedProvider({ ...demoBrains, QA: (s): import("../helpers/scripted-provider").Step => (s.turn === 1 ? { tool: "view_diff", input: {} } : { tool: "submit_report", input: { verdict: "PASS", testSummary: "Looks fine", commandsExecuted: [], relevantOutput: "", regressionAnalysis: "No regressions seen.", implementationReview: "Looks fine to me.", outstandingConcerns: [], recommendation: "Ship it." } }) }));
    const incident = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const done = await waitForStatus(incident.id, ["BLOCKED", "FAILED", "AWAITING_APPROVAL"], 60_000);
    expect(done.status).toBe("BLOCKED");
    const override = await db.evidence.findFirst({ where: { incidentId: incident.id, title: { startsWith: "QA verdict changed from PASS" } } });
    expect(override?.verificationStatus).toBe("CONTRADICTED");
    expect(override?.description).toMatch(/executed no tests/);
    setProviderForTests(provider);
  });

  it("records a rejection with its reason and does not resolve", async () => {
    const { user, workspace, repo } = await makeUser("rej@example.com", "Rey Jecter");
    const incident = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    await waitForStatus(incident.id, ["AWAITING_APPROVAL"], 60_000);
    const rejected = await rejectFix(incident.id, { id: user.id, name: user.name }, "Please add a regression test first.");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.resolvedAt).toBeNull();
    const a = await db.approval.findFirstOrThrow({ where: { incidentId: incident.id } });
    expect(a).toMatchObject({ decision: "REJECTED", reason: "Please add a regression test first." });
  });
});
