import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/src/lib/database/client";
import { setProviderForTests } from "@/src/lib/ai";
import { HttpSwitchBackend } from "@/src/lib/switch/client";
import { SwitchCollaboration, setSwitchForTests } from "@/src/lib/switch";
import { ensureRuntime } from "@/src/orchestration/runtime";
import { createIncident } from "@/src/services/incidents";
import { demoBrains, ScriptedProvider } from "../helpers/scripted-provider";
import { makeUser, resetDb, waitFor, waitForStatus } from "../helpers/fixtures";
import { startMockSwitch, type MockSwitch } from "../helpers/mock-switch-server";

const report = { title: "Registration endpoint returns HTTP 500", description: "Users cannot complete registration. The endpoint returns a server error instead of creating an account.", autoStart: true };

describe("live Switch client over HTTP + SSE (documented agent protocol)", () => {
  let mock: MockSwitch;
  let sw: SwitchCollaboration;

  beforeAll(async () => {
    await resetDb();
    mock = await startMockSwitch();
    sw = new SwitchCollaboration(new HttpSwitchBackend(mock.url, "test-registration-token"), { prefix: "patchwork", scope: `live:${mock.url}`, internalOnly: true, humanUserNames: [] });
    setSwitchForTests(sw);
    setProviderForTests(new ScriptedProvider(demoBrains));
    await ensureRuntime();
  });
  afterAll(async () => {
    await sw.stop();
    await mock.close();
  });

  it("registers five agents with the registration token and stores their keys encrypted", async () => {
    const regs = mock.requests.filter((r) => r.method === "POST" && r.path === "/agents");
    expect(regs).toHaveLength(5);
    expect(regs.every((r) => r.auth === "Bearer test-registration-token")).toBe(true);
    expect(regs.map((r) => (r.body as { name: string }).name).sort()).toEqual(["patchwork-fixer", "patchwork-investigator", "patchwork-qa", "patchwork-relay", "patchwork-triage"]);
    expect((regs[0].body as { connector_type: string; integration_profile: { connection_model: string } }).integration_profile.connection_model).toBe("always_on");
    const creds = await db.credential.findMany({ where: { kind: "SWITCH_AGENT" } });
    expect(creds).toHaveLength(5);
    for (const c of creds) expect(c.ciphertext).not.toMatch(/sim_/); // only ciphertext at rest
    // One stream per identity; agents filter to addressed events, the relay sees everything.
    await waitFor(async () => mock.opens.length >= 5, { label: "streams" });
    expect(mock.opens.filter((o) => o.filter === "addressed")).toHaveLength(4);
    expect(mock.opens.filter((o) => o.filter === "all")).toHaveLength(1);
    expect(sw.status().healthy).toBe(true);
  });

  it("runs the whole incident workflow through the HTTP bridge", async () => {
    const { user, workspace, repo } = await makeUser();
    const incident = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const done = await waitForStatus(incident.id, ["AWAITING_APPROVAL", "FAILED", "BLOCKED"], 60_000);
    expect(done.lastError).toBeNull();
    expect(done.status).toBe("AWAITING_APPROVAL");
    expect(done.switchMode).toBe("live");

    // Room created via the create_room operation, by the relay identity.
    const create = mock.requests.find((r) => r.path.endsWith("/ops/create_room"))!;
    expect((create.body as { agent_names: string[] }).agent_names).toHaveLength(5);
    expect((create.body as { internal_only: boolean }).internal_only).toBe(true);

    // Every message was posted with POST /agents/{id}/message and @mentions in the content.
    const posts = mock.requests.filter((r) => r.path.endsWith("/message"));
    expect(posts.length).toBeGreaterThanOrEqual(10);
    expect(posts.some((p) => (p.body as { content: string }).content.startsWith("@patchwork-investigator "))).toBe(true);

    // Each handoff reached the receiving agent over its SSE stream.
    const delivered = await db.activityEvent.findMany({ where: { incidentId: incident.id, eventType: "SWITCH_HANDOFF_DELIVERED" }, orderBy: { seq: "asc" } });
    expect(delivered.map((e) => (e.metadata as { kind: string }).kind)).toEqual(["incident.opened", "investigate", "fix", "verify", "fix", "verify", "qa.passed"]);
    expect(delivered[0].description).toMatch(/via Switch \(event #\d+\)/);

    // The relay's all-events stream confirmed delivery of PATCHWORK's own messages.
    await waitFor(async () => {
      const msgs = await db.agentMessage.findMany({ where: { incidentId: incident.id, senderType: "AGENT" } });
      return msgs.length > 0 && msgs.every((m) => (m.metadata as { switch: { delivered: boolean } }).switch.delivered);
    }, { label: "delivery confirmation" });
  });

  it("reopens the stream with the same connection id and Last-Event-ID when a heartbeat returns 404", async () => {
    const triage = sw.status().identities.find((i) => i.key === "TRIAGE")!;
    const before = mock.opens.filter((o) => o.agentId === triage.agentId);
    mock.failNextBeat(triage.agentId, 404);
    await waitFor(async () => mock.opens.filter((o) => o.agentId === triage.agentId).length > before.length, { label: "reopen", timeoutMs: 15_000 });
    const after = mock.opens.filter((o) => o.agentId === triage.agentId);
    const reopen = after[after.length - 1];
    expect(reopen.connectionId).toBe(before[0].connectionId); // the client owns and reuses its connection id
    expect(reopen.lastEventId).toMatch(/^\d+$/);
    await waitFor(async () => sw.status().identities.find((i) => i.key === "TRIAGE")!.connection?.state === "open", { label: "reconnected" });
  });

  it("recovers from an evicted stream and keeps working", async () => {
    const qa = sw.status().identities.find((i) => i.key === "QA")!;
    const n = mock.opens.filter((o) => o.agentId === qa.agentId).length;
    mock.evict(qa.agentId);
    await waitFor(async () => mock.opens.filter((o) => o.agentId === qa.agentId).length > n, { label: "reopen after eviction", timeoutMs: 15_000 });
    // A new incident still completes after the reconnect.
    const { user, workspace, repo } = await makeUser("evict@example.com", "Eve Victed");
    const incident = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const done = await waitForStatus(incident.id, ["AWAITING_APPROVAL", "FAILED", "BLOCKED"], 60_000);
    expect(done.status).toBe("AWAITING_APPROVAL");
  });

  it("fails the incident visibly when Switch room creation fails, and Retry recovers", async () => {
    mock.failOp("create_room", 1);
    const { user, workspace, repo } = await makeUser("roomfail@example.com", "Ro Omfail");
    const incident = await createIncident(user, { ...report, workspaceId: workspace.id, repositoryId: repo.id });
    const failed = await waitForStatus(incident.id, ["FAILED"], 20_000);
    expect(failed.lastError).toMatch(/Switch room initialization failed/);
    expect(await db.activityEvent.count({ where: { incidentId: incident.id, eventType: "SWITCH_ROOM_FAILED" } })).toBe(1);
    const { retryIncident } = await import("@/src/orchestration/workflow");
    expect(await retryIncident(incident.id, { id: user.id, name: user.name })).toBe(true);
    const done = await waitForStatus(incident.id, ["AWAITING_APPROVAL", "BLOCKED"], 60_000);
    expect(done.status).toBe("AWAITING_APPROVAL");
  });

  it("reuses stored credentials on restart instead of re-registering", async () => {
    await sw.stop();
    const before = mock.requests.filter((r) => r.path === "/agents").length;
    const sw2 = new SwitchCollaboration(new HttpSwitchBackend(mock.url, "test-registration-token"), { prefix: "patchwork", scope: `live:${mock.url}`, internalOnly: true, humanUserNames: [] });
    await sw2.start();
    expect(mock.requests.filter((r) => r.path === "/agents").length).toBe(before);
    expect(mock.requests.filter((r) => r.method === "GET" && r.path.endsWith("/ops")).length).toBeGreaterThanOrEqual(5);
    await sw2.stop();
  });

  it("rejects a bad registration token with a clear error", async () => {
    await db.credential.deleteMany({ where: { kind: "SWITCH_AGENT" } });
    const bad = new SwitchCollaboration(new HttpSwitchBackend(mock.url, "wrong"), { prefix: "other", scope: "live:bad", internalOnly: true, humanUserNames: [] });
    await expect(bad.start()).rejects.toThrow(/registration .* failed with HTTP 401/);
  });
});
