/**
 * Incident workflow orchestrator.
 *
 * Switch carries the collaboration: every handoff between agents is a room
 * message that @mentions the next agent, and that agent starts work only when
 * Switch delivers the message to its event stream. The orchestrator manages
 * application state around it: transitions (compare-and-set), idempotent
 * tasks, retry limits, timeouts, honesty checks on agent claims, persistence,
 * and the human approval gate.
 */
import type { AgentRole, Incident, IncidentStatus, Repository } from "@prisma/client";
import { config } from "@/src/lib/config";
import { db } from "@/src/lib/database/client";
import { emitEvent } from "@/src/lib/events/bus";
import { getProvider, AIProviderUnavailableError } from "@/src/lib/ai";
import { getSwitch, type InboundHandoff } from "@/src/lib/switch";
import { prepareWorkspace, commitAll, diffAgainst } from "@/src/lib/execution/workspace";
import { git } from "@/src/lib/execution/git";
import { getWorkspaceGitHubToken } from "@/src/lib/github/tokens";
import { AGENTS, modelFor } from "@/src/agents/registry";
import { runAgent, AgentTimeoutError, InvalidAgentResponseError } from "@/src/agents/base/agent";
import type { ToolContext } from "@/src/agents/base/tools";
import { consultAgent } from "@/src/agents/consult";
import type { FixReport, InvestigationReport, QAReport, TriageReport } from "@/src/schemas/agents";
import { recordAgentEvidence, recordObservation, supersedeEarlierTestEvidence } from "@/src/services/evidence";
import { newTaskKey, postNotice, postToRoom } from "@/src/services/room-messages";
import { buildContext } from "./context";
import { ACTIVE_STATUSES, TERMINAL_STATUSES, transition } from "./state-machine";
import { agentIdFor, claimTask, completeTask, failTask, roleName } from "./task-manager";

type Loaded = Incident & { repository: Repository };

const g = globalThis as unknown as { __patchworkRuns?: Map<string, AbortController>; __patchworkWatchdogs?: Map<string, NodeJS.Timeout> };
const runs = (g.__patchworkRuns ??= new Map());
const watchdogs = (g.__patchworkWatchdogs ??= new Map());

/** Handoffs must be picked up within this window or they are redelivered once. */
export const HANDOFF_ACK_MS = Number(process.env.PATCHWORK_HANDOFF_ACK_MS ?? 60_000);

async function load(incidentId: string): Promise<Loaded> {
  return db.incident.findUniqueOrThrow({ where: { id: incidentId }, include: { repository: true } });
}

function background(label: string, fn: () => Promise<void>) {
  void fn().catch((e) => console.error(`[workflow] ${label} crashed`, e));
}

async function statusChanged(incident: { id: string; workspaceId: string }, from: IncidentStatus | string, to: IncidentStatus, why: string) {
  await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_STATUS_CHANGED", description: `${from} → ${to}: ${why}`, metadata: { from, to } });
}

// ───────────────────────────── Start ─────────────────────────────

export async function startIncident(incidentId: string): Promise<boolean> {
  const incident = await load(incidentId);
  const ok = await transition(incidentId, "NEW", "TRIAGING");
  if (!ok) return false;
  await statusChanged(incident, "NEW", "TRIAGING", "investigation started");
  background("kickoff", () => kickoff(incidentId, 1));
  return true;
}

async function kickoff(incidentId: string, attempt: number) {
  let incident = await load(incidentId);
  try {
    incident = await ensureRoom(incident);
    incident = await ensureWorkspace(incident);
    const report = [`New incident INC-${incident.number}: "${incident.title}" in ${incident.repository.fullName}.`, incident.description.slice(0, 1200), incident.errorMessage ? `Error: ${incident.errorMessage.slice(0, 400)}` : ""].filter(Boolean).join("\n\n");
    await sendWork(incident, "RELAY", "TRIAGE", `${report}\n\nPlease triage.`, "incident.opened", "triage", attempt, "TASK_DELEGATION");
  } catch (e) {
    await failIncident(incidentId, "initialization", e);
  }
}

async function ensureRoom(incident: Loaded): Promise<Loaded> {
  if (incident.switchRoomId) return incident;
  const sw = getSwitch();
  try {
    await sw.start();
    const room = await sw.createRoom({ number: incident.number, title: incident.title, repositoryFullName: incident.repository.fullName, severity: incident.severity });
    const updated = await db.incident.update({ where: { id: incident.id }, data: { switchRoomId: room.id, switchRoomName: room.name, switchMode: sw.backend.mode }, include: { repository: true } });
    await emitEvent({
      incidentId: incident.id,
      workspaceId: incident.workspaceId,
      actorType: "SYSTEM",
      eventType: "SWITCH_ROOM_CREATED",
      description: `${sw.backend.mode === "live" ? "Switch" : "Simulated (local) Switch"} room ${room.name} created`,
      metadata: { roomId: room.id, roomName: room.name, mode: sw.backend.mode, transportRoomId: room.transportRoomId },
    });
    const participants = await sw.participants(room.id);
    const names = sw.names();
    for (const role of ["TRIAGE", "INVESTIGATOR", "FIXER", "QA"] as AgentRole[]) {
      const p = participants.find((x) => x.name === names[role]);
      await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: agentIdFor(role), eventType: "AGENT_JOINED_ROOM", description: `${roleName(role)} joined ${room.name}${p ? "" : " (membership requested at creation)"}`, metadata: { switchName: names[role], verified: !!p, status: p?.status ?? null } });
    }
    return updated;
  } catch (e) {
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "SWITCH_ROOM_FAILED", description: `Switch room initialization failed: ${(e as Error).message}` });
    throw new Error(`Switch room initialization failed: ${(e as Error).message}`);
  }
}

async function ensureWorkspace(incident: Loaded): Promise<Loaded> {
  if (incident.workspacePath && incident.baseCommit && incident.workingBranch) return incident;
  const token = incident.repository.provider === "GITHUB" ? await getWorkspaceGitHubToken(incident.workspaceId) : null;
  const ws = await prepareWorkspace(incident, incident.repository, token);
  const updated = await db.incident.update({ where: { id: incident.id }, data: { workspacePath: ws.dir, workingBranch: ws.branch, baseCommit: ws.baseCommit }, include: { repository: true } });
  await recordObservation({
    incidentId: incident.id,
    agentId: null,
    type: "REPOSITORY_METADATA",
    title: `Working branch ${ws.branch} created from ${incident.repository.defaultBranch}@${ws.baseCommit.slice(0, 8)}`,
    description: `Isolated checkout of ${incident.repository.fullName} for this incident. The default branch is never modified.`,
    source: "PATCHWORK repository workspace",
    status: "VERIFIED",
    note: "Created and read back by PATCHWORK with git.",
  });
  return updated;
}

// ─────────────────────────── Handoffs ───────────────────────────

async function sendWork(incident: Loaded, from: AgentRole | "RELAY", to: AgentRole | "RELAY", text: string, kind: InboundHandoff["handoff"]["kind"], stage: string, attempt: number, messageType: "TASK_DELEGATION" | "FINDING" | "IMPLEMENTATION" | "QA_REPORT", data?: Record<string, unknown>) {
  const taskKey = newTaskKey(stage, attempt);
  await postToRoom({ incident, from, to: [to], text, messageType, handoff: { kind, taskKey, attempt, data } });
  if (to !== "RELAY") armWatchdog(incident.id, { from, to, text, kind, stage, attempt, messageType, taskKey, data });
}

type PendingHandoff = { from: AgentRole | "RELAY"; to: AgentRole; text: string; kind: InboundHandoff["handoff"]["kind"]; stage: string; attempt: number; messageType: "TASK_DELEGATION" | "FINDING" | "IMPLEMENTATION" | "QA_REPORT"; taskKey: string; data?: Record<string, unknown> };

/** If no agent claims the task in time (dropped stream, lost event), redeliver once, then fail loudly. */
function armWatchdog(incidentId: string, h: PendingHandoff, redelivered = false) {
  const timer = setTimeout(async () => {
    watchdogs.delete(h.taskKey);
    const task = await db.agentTask.findUnique({ where: { incidentId_key: { incidentId, key: h.taskKey } } });
    if (task) return;
    const incident = await load(incidentId);
    if (TERMINAL_STATUSES.includes(incident.status) || !ACTIVE_STATUSES.includes(incident.status)) return;
    if (!redelivered) {
      await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "WORKFLOW_ERROR", description: `${roleName(h.to)} has not picked up the ${h.kind} handoff after ${Math.round(HANDOFF_ACK_MS / 1000)}s; redelivering via Switch.` });
      try {
        await postToRoom({ incident, from: h.from, to: [h.to], text: `(redelivery) ${h.text}`, messageType: h.messageType, handoff: { kind: h.kind, taskKey: h.taskKey, attempt: h.attempt, data: h.data } });
        armWatchdog(incidentId, h, true);
      } catch (e) {
        await failIncident(incidentId, h.stage, e);
      }
    } else {
      await failIncident(incidentId, h.stage, new Error(`${roleName(h.to)} did not respond to the ${h.kind} handoff via Switch (agent disconnected or message not delivered).`));
    }
  }, HANDOFF_ACK_MS);
  timer.unref?.();
  watchdogs.set(h.taskKey, timer);
}

function disarm(taskKey: string) {
  const t = watchdogs.get(taskKey);
  if (t) clearTimeout(t);
  watchdogs.delete(taskKey);
}

/** Entry point for every addressed message Switch delivers to an agent. */
export async function handleHandoff(inb: InboundHandoff) {
  const { handoff, role } = inb;
  const incident = await db.incident.findUnique({ where: { id: handoff.incidentId }, include: { repository: true } });
  if (!incident || incident.switchRoomId !== inb.roomId) return; // not ours, or wrong room
  disarm(handoff.taskKey);
  await emitEvent({
    incidentId: incident.id,
    workspaceId: incident.workspaceId,
    actorType: "AGENT",
    actorId: agentIdFor(role),
    eventType: "SWITCH_HANDOFF_DELIVERED",
    description: `${roleName(role)} received "${handoff.kind}" from ${inb.senderName} via ${getSwitch().backend.mode === "live" ? "Switch" : "the Switch simulator"} (event #${inb.sequence})${inb.gapBefore ? " after a stream gap" : ""}`,
    metadata: { kind: handoff.kind, taskKey: handoff.taskKey, sequence: inb.sequence, switchMessageId: inb.messageId, gapBefore: inb.gapBefore },
  });

  const route = `${role}:${handoff.kind}`;
  switch (route) {
    case "TRIAGE:incident.opened":
      return runTriage(incident, handoff.taskKey, handoff.attempt);
    case "INVESTIGATOR:investigate":
      return runInvestigation(incident, handoff.taskKey, handoff.attempt);
    case "FIXER:fix":
      return runFix(incident, handoff.taskKey, handoff.attempt);
    case "QA:verify":
      return runQA(incident, handoff.taskKey, handoff.attempt);
    case "TRIAGE:qa.passed":
      return requestApproval(incident, handoff.taskKey, handoff.attempt);
    default:
      if (handoff.kind === "human.note") return answerHuman(incident, role, handoff.taskKey, String(handoff.data?.message ?? inb.text));
  }
}

// ───────────────────────────── Stages ─────────────────────────────

type StageCtx = { incident: Loaded; taskId: string; toolCtx: ToolContext; signal: AbortSignal };

async function runStage(incident: Loaded, role: AgentRole, stage: string, taskKey: string, attempt: number, expected: IncidentStatus[], title: string, body: (s: StageCtx) => Promise<unknown>) {
  const current = await load(incident.id);
  if (!expected.includes(current.status)) return; // stale or cancelled
  const task = await claimTask({ incidentId: incident.id, workspaceId: incident.workspaceId, role, key: taskKey, stage, attempt, title, description: `${AGENTS[role].displayName}: ${title}` });
  if (!task) return; // duplicate delivery: already handled
  await postNotice({ incident: current, from: role, to: [], text: `Picked up: ${title}.`, messageType: "STATUS_UPDATE" });

  const controller = new AbortController();
  runs.set(incident.id, controller);
  const toolCtx: ToolContext = {
    incidentId: incident.id,
    workspaceId: incident.workspaceId,
    agentId: agentIdFor(role),
    agentName: AGENTS[role].displayName,
    workspaceDir: current.workspacePath ?? "",
    baseCommit: current.baseCommit ?? "HEAD",
    attempt,
    taskId: task.id,
    signal: controller.signal,
    trace: { filesRead: new Set(), filesWritten: new Set(), testRunIds: [] },
  };
  try {
    const result = await body({ incident: current, taskId: task.id, toolCtx, signal: controller.signal });
    await completeTask(task.id, role, result, { incidentId: incident.id, workspaceId: incident.workspaceId });
  } catch (e) {
    await failTask(task.id, role, (e as Error).message, { incidentId: incident.id, workspaceId: incident.workspaceId });
    if (!controller.signal.aborted || e instanceof AgentTimeoutError) await failIncident(incident.id, stage, e);
  } finally {
    if (runs.get(incident.id) === controller) runs.delete(incident.id);
  }
}

async function agentRun<T>(role: AgentRole, s: StageCtx, context: string, def = AGENTS[role]) {
  const c = config();
  const out = await runAgent<T>(def, { provider: getProvider(), model: modelFor(role), context, toolCtx: s.toolCtx, maxSteps: c.AGENT_MAX_STEPS, timeoutMs: c.AGENT_TIMEOUT_MS, signal: s.signal });
  return out;
}

async function runTriage(incident: Loaded, taskKey: string, attempt: number) {
  await runStage(incident, "TRIAGE", "triage", taskKey, attempt, ["TRIAGING"], "Triage the bug report", async (s) => {
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_triage", eventType: "TRIAGE_STARTED", description: "PATCHWORK_Triage is analyzing the report" });
    const out = await agentRun<TriageReport>("TRIAGE", s, await buildContext(s.incident, "TRIAGE"));
    const r = out.report;
    await db.incident.update({ where: { id: incident.id }, data: { severity: r.severity, affectedArea: r.affectedFunctionality.join(", ").slice(0, 500) } });
    await recordObservation({ incidentId: incident.id, agentId: "agent_triage", title: "Initial hypothesis (to be tested)", description: r.initialHypothesis, source: "PATCHWORK_Triage", influence: "Directed the investigation; not treated as a finding", taskId: s.taskId });
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_triage", eventType: "TRIAGE_COMPLETED", description: `Classified as ${r.classification}, severity ${r.severity}`, metadata: { severity: r.severity } });

    if (r.needsMoreInformation) {
      if (await transition(incident.id, "TRIAGING", "NEEDS_INFORMATION")) {
        await statusChanged(incident, "TRIAGING", "NEEDS_INFORMATION", "the report is too vague to investigate");
        await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_triage", eventType: "NEEDS_INFORMATION", description: r.missingInformation.join("; ") });
        await postNotice({ incident: s.incident, from: "TRIAGE", to: ["RELAY"], text: `I need more information before the team can investigate:\n${r.missingInformation.map((m) => `- ${m}`).join("\n")}`, messageType: "STATUS_UPDATE" });
      }
      return { report: r, model: out.model, steps: out.steps, toolCalls: out.toolCalls };
    }

    if (!(await transition(incident.id, "TRIAGING", "INVESTIGATING"))) return { report: r, model: out.model, steps: out.steps };
    await statusChanged(incident, "TRIAGING", "INVESTIGATING", "triage complete");
    const tasks = r.delegatedTasks.filter((t) => t.agent === "INVESTIGATOR").map((t) => `- ${t.task}`);
    await sendWork(
      await load(incident.id),
      "TRIAGE",
      "INVESTIGATOR",
      `Triage: ${r.classification}, severity ${r.severity} (${r.severityRationale}). Affected: ${r.affectedFunctionality.join(", ")}.\nHypothesis to test (not verified): ${r.initialHypothesis}\nInvestigation tasks:\n${tasks.join("\n") || r.investigationPlan.map((p) => `- ${p}`).join("\n")}`,
      "investigate",
      "investigation",
      1,
      "TASK_DELEGATION",
    );
    return { report: r, model: out.model, steps: out.steps, toolCalls: out.toolCalls };
  });
}

async function runInvestigation(incident: Loaded, taskKey: string, attempt: number) {
  await runStage(incident, "INVESTIGATOR", "investigation", taskKey, attempt, ["INVESTIGATING"], "Investigate the repository and find the root cause", async (s) => {
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_investigator", eventType: "INVESTIGATION_STARTED", description: "PATCHWORK_Investigator is examining the repository" });
    const out = await agentRun<InvestigationReport>("INVESTIGATOR", s, await buildContext(s.incident, "INVESTIGATOR"));
    const r = out.report;

    // Never accept a reproduction claim without a recorded failing run.
    if (r.reproduction.reproduced) {
      const runsInTask = await db.testRun.findMany({ where: { id: { in: s.toolCtx.trace.testRunIds } } });
      const failing = runsInTask.filter((t) => t.status !== "PASSED" && (!r.reproduction.command || t.command === r.reproduction.command.trim()));
      if (!failing.length) {
        r.reproduction.reproduced = false;
        await recordObservation({ incidentId: incident.id, agentId: "agent_investigator", title: "Reproduction claim not supported", description: `The Investigator reported reproducing the issue${r.reproduction.command ? ` with \`${r.reproduction.command}\`` : ""}, but no failing command run was recorded in its task.`, source: "PATCHWORK verification", status: "CONTRADICTED", note: "Checked against recorded test runs.", taskId: s.taskId });
      }
    }

    const reportText = `${incident.errorMessage ?? ""}\n${incident.stackTrace ?? ""}`;
    const evidence = await recordAgentEvidence(r.evidence, { incidentId: incident.id, agentId: "agent_investigator", workspaceDir: s.incident.workspacePath, testRunIds: s.toolCtx.trace.testRunIds, reportText, attempt, taskId: s.taskId }, "Supports the root cause", "PATCHWORK_Investigator");
    for (const h of r.hypotheses) await recordObservation({ incidentId: incident.id, agentId: "agent_investigator", title: "Unverified hypothesis", description: h, source: "PATCHWORK_Investigator", influence: "Context only", taskId: s.taskId });
    await db.incident.update({ where: { id: incident.id }, data: { rootCause: r.rootCause.slice(0, 3000) } });
    const verified = evidence.filter((e) => e.verificationStatus === "VERIFIED").length;
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_investigator", eventType: "INVESTIGATION_COMPLETED", description: `Root cause identified (${r.confidence} confidence, ${verified}/${evidence.length} evidence items verified)`, metadata: { confidence: r.confidence } });

    if (!(await transition(incident.id, "INVESTIGATING", "FIXING", { fixAttempts: 1 }))) return { report: r, model: out.model };
    await statusChanged(incident, "INVESTIGATING", "FIXING", "root cause identified");
    const locs = r.codeLocations.slice(0, 4).map((c) => `- \`${c.path}:${c.lineStart}${c.lineEnd > c.lineStart ? `-${c.lineEnd}` : ""}\` ${c.description}`);
    await sendWork(
      await load(incident.id),
      "INVESTIGATOR",
      "FIXER",
      `Findings (${r.confidence} confidence, ${verified}/${evidence.length} evidence items verified by PATCHWORK):\nRoot cause: ${r.rootCause}\n${locs.join("\n")}\nReproduced: ${r.reproduction.reproduced ? `yes (\`${r.reproduction.command}\`)` : "no"}.\nRecommended fix: ${r.recommendedFix}`,
      "fix",
      "fix",
      1,
      "FINDING",
    );
    return { report: r, model: out.model, steps: out.steps, toolCalls: out.toolCalls };
  });
}

async function runFix(incident: Loaded, taskKey: string, attempt: number) {
  await runStage(incident, "FIXER", "fix", taskKey, attempt, ["FIXING"], `Implement fix attempt ${attempt}`, async (s) => {
    await db.incident.update({ where: { id: incident.id }, data: { fixAttempts: attempt } });
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_fixer", eventType: "FIX_STARTED", description: `PATCHWORK_Fixer started fix attempt ${attempt} of ${s.incident.maxFixAttempts} on ${s.incident.workingBranch}`, metadata: { attempt } });
    const out = await agentRun<FixReport>("FIXER", s, await buildContext({ ...s.incident, fixAttempts: attempt }, "FIXER", { attempt }));
    const r = out.report;
    const dir = s.incident.workspacePath!;
    const headBefore = s.incident.headCommit ?? s.incident.baseCommit!;
    const commit = await commitAll(dir, `fix(INC-${s.incident.number}): ${r.summary.split("\n")[0].slice(0, 60)} [attempt ${attempt}]\n\n${r.rootCauseAddressed}\n\nGenerated by PATCHWORK_Fixer. Not merged; requires human approval.`);
    const changes = await diffAgainst(dir, s.incident.baseCommit!);

    if (!commit || !changes.length) {
      await recordObservation({ incidentId: incident.id, agentId: "agent_fixer", title: `Fix attempt ${attempt} produced no code changes`, description: r.summary, source: "PATCHWORK git", status: "VERIFIED", note: "git status showed no modifications after the Fixer finished.", attempt, taskId: s.taskId });
      if (await transition(incident.id, "FIXING", "BLOCKED", { lastError: `Fix attempt ${attempt} produced no code changes.` })) {
        await statusChanged(incident, "FIXING", "BLOCKED", "the Fixer made no changes");
        await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_BLOCKED", description: "The Fixer did not change any files; human guidance needed." });
        await postNotice({ incident: s.incident, from: "FIXER", to: ["RELAY"], text: `I could not produce a change for this incident: ${r.summary}`, messageType: "STATUS_UPDATE" });
      }
      return { report: r, model: out.model };
    }

    await db.codeChange.createMany({ data: changes.map((c) => ({ incidentId: incident.id, attempt, filePath: c.filePath, changeType: c.changeType, additions: c.additions, deletions: c.deletions, diff: c.diff, commitSha: commit })) });
    await db.incident.update({ where: { id: incident.id }, data: { headCommit: commit } });

    // Compare the Fixer's description with what this attempt's commit actually changed.
    const actual = new Set((await git(dir, ["diff", "--name-only", headBefore, commit])).stdout.split("\n").map((l) => l.trim()).filter(Boolean));
    const claimed = new Set(r.filesModified.map((f) => f.path.replace(/\\/g, "/").replace(/^\.\//, "")));
    for (const c of changes)
      await recordObservation({ incidentId: incident.id, agentId: "agent_fixer", type: "CODE_REFERENCE", filePath: c.filePath, title: `${c.changeType === "ADDED" ? "Added" : c.changeType === "DELETED" ? "Deleted" : "Modified"} ${c.filePath} (+${c.additions} −${c.deletions})`, description: r.filesModified.find((f) => f.path.replace(/\\/g, "/").replace(/^\.\//, "") === c.filePath)?.description ?? "Changed by the Fixer but not described in its report.", source: `git diff ${s.incident.baseCommit!.slice(0, 8)}..${commit.slice(0, 8)}`, status: "VERIFIED", note: "Diff captured by PATCHWORK from the working branch.", influence: `Proposed fix, attempt ${attempt}`, attempt, taskId: s.taskId });
    const phantom = [...claimed].filter((p) => !actual.has(p));
    if (phantom.length) await recordObservation({ incidentId: incident.id, agentId: "agent_fixer", title: "Fixer described changes that are not in its commit", description: `Claimed but unchanged: ${phantom.join(", ")}`, source: "PATCHWORK verification", status: "CONTRADICTED", note: "Compared the report's filesModified with this attempt's commit.", attempt, taskId: s.taskId });

    const add = changes.reduce((n, c) => n + c.additions, 0);
    const del = changes.reduce((n, c) => n + c.deletions, 0);
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_fixer", eventType: "CODE_CHANGED", description: `Committed ${commit.slice(0, 8)} on ${s.incident.workingBranch}: ${changes.length} file(s), +${add} −${del}`, metadata: { attempt, commit, files: changes.map((c) => c.filePath) } });

    if (!(await transition(incident.id, "FIXING", "TESTING"))) return { report: r, model: out.model };
    await statusChanged(incident, "FIXING", "TESTING", `fix attempt ${attempt} committed`);
    await sendWork(
      await load(incident.id),
      "FIXER",
      "QA",
      `Fix attempt ${attempt} is on \`${s.incident.workingBranch}\` (commit ${commit.slice(0, 8)}): ${changes.map((c) => `\`${c.filePath}\` +${c.additions}/−${c.deletions}`).join(", ")}.\n${r.summary}\n${r.respondedToFeedback ? `Addressing QA feedback: ${r.respondedToFeedback}\n` : ""}Please verify. Suggested tests: ${r.testsToRun.map((t) => `\`${t}\``).join(", ")}.`,
      "verify",
      "qa",
      attempt,
      "IMPLEMENTATION",
    );
    return { report: r, model: out.model, steps: out.steps, toolCalls: out.toolCalls, commit };
  });
}

/** PATCHWORK's own rule for accepting a QA verdict. Exported for tests. */
export function enforceVerdict(report: QAReport, runsInTask: { command: string; status: string; startedAt: Date }[]): { verdict: QAReport["verdict"]; override: string | null } {
  if (report.verdict !== "PASS") return { verdict: report.verdict, override: null };
  if (!runsInTask.length) return { verdict: "NEEDS_REVIEW", override: "QA reported PASS but executed no tests in its task." };
  const latestByCommand = new Map<string, string>();
  for (const r of [...runsInTask].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) latestByCommand.set(r.command, r.status);
  const failing = [...latestByCommand.entries()].filter(([, st]) => st !== "PASSED");
  if (failing.length) return { verdict: "FAIL", override: `QA reported PASS but the latest run of ${failing.map(([c, st]) => `\`${c}\` was ${st}`).join(", ")}.` };
  return { verdict: "PASS", override: null };
}

async function runQA(incident: Loaded, taskKey: string, attempt: number) {
  await runStage(incident, "QA", "qa", taskKey, attempt, ["TESTING"], `Verify fix attempt ${attempt}`, async (s) => {
    if (attempt > 1) await supersedeEarlierTestEvidence(incident.id, attempt, ["agent_qa", "agent_fixer"]);
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_qa", eventType: "QA_STARTED", description: `PATCHWORK_QA is verifying fix attempt ${attempt}`, metadata: { attempt } });
    const out = await agentRun<QAReport>("QA", s, await buildContext(s.incident, "QA", { attempt }));
    const r = out.report;
    const runsInTask = await db.testRun.findMany({ where: { id: { in: s.toolCtx.trace.testRunIds } } });
    const { verdict, override } = enforceVerdict(r, runsInTask);
    if (override) {
      await recordObservation({ incidentId: incident.id, agentId: "agent_qa", title: `QA verdict changed from PASS to ${verdict}`, description: override, source: "PATCHWORK verification", status: "CONTRADICTED", note: "PATCHWORK only accepts PASS when tests were executed and the latest run of each passed.", attempt, taskId: s.taskId });
      r.verdict = verdict;
    }
    await recordObservation({ incidentId: incident.id, agentId: "agent_qa", title: `QA review of attempt ${attempt}: ${verdict}`, description: `${r.implementationReview}\n\nRegression analysis: ${r.regressionAnalysis}`, source: "PATCHWORK_QA", influence: verdict === "PASS" ? "Supports approval" : "Returned the fix for rework", attempt, taskId: s.taskId });
    const result = { report: r, verdict, override, model: out.model, steps: out.steps, toolCalls: out.toolCalls, testRunIds: s.toolCtx.trace.testRunIds };

    const fresh = await load(incident.id);
    if (verdict === "PASS") {
      await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_qa", eventType: "FIX_PASSED", description: `QA passed attempt ${attempt}: ${r.testSummary.slice(0, 160)}`, metadata: { attempt } });
      await sendWork(fresh, "QA", "TRIAGE", `PASS for fix attempt ${attempt}. ${r.testSummary}\nCommands executed: ${r.commandsExecuted.map((c) => `\`${c}\``).join(", ")}.\nRegressions: ${r.regressionAnalysis}`, "qa.passed", "approval", attempt, "QA_REPORT");
      return result;
    }

    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_qa", eventType: "FIX_FAILED", description: `QA ${verdict} for attempt ${attempt}: ${r.testSummary.slice(0, 160)}`, metadata: { attempt, verdict } });
    if (verdict === "FAIL" && attempt < fresh.maxFixAttempts) {
      if (await transition(incident.id, "TESTING", "FIXING")) {
        await statusChanged(incident, "TESTING", "FIXING", `QA failed attempt ${attempt}; returning to the Fixer`);
        await sendWork(await load(incident.id), "QA", "FIXER", `FAIL for fix attempt ${attempt}. ${r.testSummary}\n${r.failureDetailsForFixer ?? r.recommendation}\nReturning to you for attempt ${attempt + 1} of ${fresh.maxFixAttempts}.`, "fix", "fix", attempt + 1, "QA_REPORT");
      }
      return result;
    }
    const why = verdict === "FAIL" ? `QA failed all ${attempt} fix attempt(s); the automatic repair limit was reached.` : `QA could not gather enough evidence to judge the fix (NEEDS_REVIEW).`;
    if (await transition(incident.id, "TESTING", "BLOCKED", { lastError: why })) {
      await statusChanged(incident, "TESTING", "BLOCKED", why);
      await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_BLOCKED", description: `${why} Human intervention required.` });
      await postNotice({ incident: fresh, from: "QA", to: ["RELAY", "TRIAGE"], text: `${verdict} for attempt ${attempt}. ${why} ${r.recommendation}`, messageType: "QA_REPORT" });
    }
    return result;
  });
}

async function requestApproval(incident: Loaded, taskKey: string, attempt: number) {
  await runStage(incident, "TRIAGE", "approval", taskKey, attempt, ["TESTING"], "Request human approval", async () => {
    if (!(await transition(incident.id, "TESTING", "AWAITING_APPROVAL"))) return {};
    await statusChanged(incident, "TESTING", "AWAITING_APPROVAL", "QA passed");
    const fresh = await load(incident.id);
    const changes = await db.codeChange.findMany({ where: { incidentId: incident.id, attempt } });
    const verified = await db.evidence.count({ where: { incidentId: incident.id, verificationStatus: "VERIFIED" } });
    const summary = `Investigation complete for INC-${fresh.number}. Root cause: ${fresh.rootCause ?? "see investigation"}\nProposed fix on \`${fresh.workingBranch}\` after ${attempt} attempt(s): ${changes.map((c) => `\`${c.filePath}\``).join(", ")}. QA passed with executed tests. ${verified} verified evidence records. Awaiting human approval; nothing will be merged automatically.`;
    await postNotice({ incident: fresh, from: "TRIAGE", to: ["RELAY"], text: summary, messageType: "STATUS_UPDATE" });
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "AGENT", actorId: "agent_triage", eventType: "APPROVAL_REQUESTED", description: "Fix verified by QA. Awaiting human approval.", metadata: { attempt } });
    return { summary };
  });
}

async function answerHuman(incident: Loaded, role: AgentRole, taskKey: string, message: string) {
  const task = await claimTask({ incidentId: incident.id, workspaceId: incident.workspaceId, role, key: taskKey, stage: "consult", attempt: 1, title: "Reply to the developer", description: message.slice(0, 500) });
  if (!task) return;
  try {
    const ctx: ToolContext = { incidentId: incident.id, workspaceId: incident.workspaceId, agentId: agentIdFor(role), agentName: AGENTS[role].displayName, workspaceDir: incident.workspacePath ?? "", baseCommit: incident.baseCommit ?? "HEAD", attempt: 1, taskId: task.id, trace: { filesRead: new Set(), filesWritten: new Set(), testRunIds: [] } };
    const out = await runAgent(consultAgent(role), { provider: getProvider(), model: modelFor(role), context: await buildContext(incident, "CONSULT", { humanMessage: message }), toolCtx: ctx, maxSteps: 10, timeoutMs: 180_000 });
    await postToRoom({ incident, from: role, to: ["RELAY"], text: out.report.reply, messageType: "CHAT" });
    await completeTask(task.id, role, { report: out.report }, { incidentId: incident.id, workspaceId: incident.workspaceId });
  } catch (e) {
    await failTask(task.id, role, (e as Error).message, { incidentId: incident.id, workspaceId: incident.workspaceId });
    await postNotice({ incident, from: "RELAY", to: [], text: `${roleName(role)} could not reply: ${(e as Error).message}`, messageType: "SYSTEM" });
  }
}

// ───────────────────────── Failure & control ─────────────────────────

export async function failIncident(incidentId: string, stage: string, err: unknown) {
  const incident = await load(incidentId);
  if (TERMINAL_STATUSES.includes(incident.status) || incident.status === "FAILED") return;
  const message =
    err instanceof AIProviderUnavailableError
      ? `AI provider unavailable: ${err.message}`
      : err instanceof AgentTimeoutError
        ? `Agent timed out: ${err.message}`
        : err instanceof InvalidAgentResponseError
          ? `Invalid agent response: ${err.message}`
          : (err as Error)?.message ?? String(err);
  const from = incident.status;
  const ok = await transition(incidentId, from, "FAILED", { lastError: `[${stage}] ${message}`.slice(0, 2000) });
  if (!ok) return;
  await statusChanged(incident, from, "FAILED", message);
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_FAILED", description: `Workflow stopped during ${stage}: ${message.replace(/\.$/, "")}. Earlier findings are kept; use Retry to resume.`, metadata: { stage } });
  if (incident.switchRoomId) await postNotice({ incident, from: "RELAY", to: [], text: `Workflow stopped during ${stage}: ${message}`, messageType: "SYSTEM" });
}

export async function cancelIncident(incidentId: string, user: { id: string; name: string }) {
  const incident = await load(incidentId);
  if (TERMINAL_STATUSES.includes(incident.status)) return false;
  const ok = await transition(incidentId, incident.status, "CANCELLED");
  if (!ok) return false;
  runs.get(incidentId)?.abort();
  await db.agentTask.updateMany({ where: { incidentId, status: "RUNNING" }, data: { status: "CANCELLED", completedAt: new Date() } });
  await statusChanged(incident, incident.status, "CANCELLED", `cancelled by ${user.name}`);
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "USER", actorId: user.id, eventType: "INCIDENT_CANCELLED", description: `${user.name} cancelled the investigation` });
  if (incident.switchRoomId) await postNotice({ incident, from: "RELAY", to: [], text: `${user.name} cancelled this investigation. Agents: stop work on INC-${incident.number}.`, messageType: "SYSTEM" });
  return true;
}

/** Resume a FAILED / BLOCKED / REJECTED / NEEDS_INFORMATION incident from the right stage. */
export async function retryIncident(incidentId: string, user: { id: string; name: string }, guidance?: string) {
  const incident = await load(incidentId);
  const c = config();
  if (guidance) await db.agentMessage.create({ data: { incidentId, senderType: "HUMAN", senderName: user.name, messageType: "HUMAN", content: guidance, metadata: { kind: "retry-guidance" } } });

  const done = async (stage: string) => !!(await db.agentTask.findFirst({ where: { incidentId, stage, status: "COMPLETED" } }));
  const say = guidance ? `\nDeveloper guidance: ${guidance}` : "";

  if (incident.status === "BLOCKED" || incident.status === "REJECTED") {
    const nextAttempt = incident.fixAttempts + 1;
    if (!(await transition(incidentId, incident.status, "FIXING", { maxFixAttempts: incident.fixAttempts + c.MAX_FIX_ATTEMPTS, lastError: null }))) return false;
    await statusChanged(incident, incident.status, "FIXING", `${user.name} sent the fix back for another attempt`);
    await sendWork(await load(incidentId), "RELAY", "FIXER", `${user.name} asked for another fix attempt (${nextAttempt}).${say}`, "fix", "fix", nextAttempt, "TASK_DELEGATION");
    return true;
  }
  if (incident.status === "NEEDS_INFORMATION") {
    if (!(await transition(incidentId, "NEEDS_INFORMATION", "TRIAGING"))) return false;
    await statusChanged(incident, "NEEDS_INFORMATION", "TRIAGING", `${user.name} added information`);
    await sendWork(await load(incidentId), "RELAY", "TRIAGE", `${user.name} added information; please triage again.${say}`, "incident.opened", "triage", 2, "TASK_DELEGATION");
    return true;
  }
  if (incident.status !== "FAILED") return false;

  const nonce = (await db.agentTask.count({ where: { incidentId } })) + 1;
  if (!incident.switchRoomId || !incident.workspacePath || !(await done("triage"))) {
    if (!(await transition(incidentId, "FAILED", "TRIAGING", { lastError: null }))) return false;
    await statusChanged(incident, "FAILED", "TRIAGING", `${user.name} retried`);
    background("kickoff", () => kickoff(incidentId, nonce));
    return true;
  }
  if (!(await done("investigation"))) {
    if (!(await transition(incidentId, "FAILED", "INVESTIGATING", { lastError: null }))) return false;
    await statusChanged(incident, "FAILED", "INVESTIGATING", `${user.name} retried`);
    await sendWork(await load(incidentId), "TRIAGE", "INVESTIGATOR", `Retrying the investigation at ${user.name}'s request.${say}`, "investigate", "investigation", nonce, "TASK_DELEGATION");
    return true;
  }
  const lastFix = await db.agentTask.findFirst({ where: { incidentId, stage: "fix" }, orderBy: { createdAt: "desc" } });
  const lastQa = await db.agentTask.findFirst({ where: { incidentId, stage: "qa" }, orderBy: { createdAt: "desc" } });
  if (lastQa && lastFix && lastQa.createdAt > lastFix.createdAt && lastFix.status === "COMPLETED") {
    if (!(await transition(incidentId, "FAILED", "TESTING", { lastError: null }))) return false;
    await statusChanged(incident, "FAILED", "TESTING", `${user.name} retried QA`);
    await sendWork(await load(incidentId), "FIXER", "QA", `Retrying verification of attempt ${lastFix.attempt} at ${user.name}'s request.${say}`, "verify", "qa", lastFix.attempt, "TASK_DELEGATION");
    return true;
  }
  const attempt = Math.max(1, incident.fixAttempts);
  if (!(await transition(incidentId, "FAILED", "FIXING", { lastError: null }))) return false;
  await statusChanged(incident, "FAILED", "FIXING", `${user.name} retried the fix`);
  await sendWork(await load(incidentId), "INVESTIGATOR", "FIXER", `Retrying fix attempt ${attempt} at ${user.name}'s request.${say}`, "fix", "fix", attempt, "TASK_DELEGATION");
  return true;
}

/** A developer message from the PATCHWORK UI, relayed into the Switch room. */
export async function postHumanMessage(incidentId: string, user: { id: string; name: string }, content: string, target: AgentRole) {
  const incident = await load(incidentId);
  if (!incident.switchRoomId) {
    return db.agentMessage.create({ data: { incidentId, senderType: "HUMAN", senderName: user.name, messageType: "HUMAN", content, metadata: { relayed: false, reason: "no Switch room yet" } } });
  }
  return postToRoom({
    incident,
    from: "RELAY",
    to: [target],
    text: `[${user.name}] ${content}`,
    messageType: "HUMAN",
    humanSender: { userId: user.id, name: user.name },
    handoff: { kind: "human.note", taskKey: newTaskKey("consult", 1), attempt: 1, data: { message: content.slice(0, 2000), from: user.name } },
  });
}

/** On boot: work that was running when the process stopped cannot be trusted to have finished. */
export async function recoverInterruptedIncidents() {
  const stuck = await db.agentTask.findMany({ where: { status: "RUNNING" }, include: { incident: true } });
  for (const t of stuck) {
    await db.agentTask.update({ where: { id: t.id }, data: { status: "FAILED", error: "Interrupted by a server restart", completedAt: new Date() } });
    if (ACTIVE_STATUSES.includes(t.incident.status)) await failIncident(t.incidentId, t.stage, new Error("Interrupted by a server restart. Findings so far are preserved; press Retry to resume."));
  }
  await db.agent.updateMany({ data: { status: "IDLE", currentTask: null } });
  // Active incidents with no running task were waiting on a handoff that may have been lost.
  const waiting = await db.incident.findMany({ where: { status: { in: ACTIVE_STATUSES } } });
  for (const i of waiting) await failIncident(i.id, i.status.toLowerCase(), new Error("The server restarted while a handoff was in flight. Press Retry to resume from this stage."));
}
