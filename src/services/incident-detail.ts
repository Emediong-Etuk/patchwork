import { db } from "@/src/lib/database/client";
import { toStreamEvent } from "@/src/lib/events/bus";
import { incidentAgentStatuses } from "./incidents";

export async function incidentDetail(incidentId: string) {
  const incident = await db.incident.findUniqueOrThrow({ where: { id: incidentId }, include: { repository: true } });
  const [agents, messages, evidence, changes, testRuns, tasks, approvals, events] = await Promise.all([
    incidentAgentStatuses(incidentId),
    db.agentMessage.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" } }),
    db.evidence.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" } }),
    db.codeChange.findMany({ where: { incidentId }, orderBy: [{ attempt: "asc" }, { filePath: "asc" }] }),
    db.testRun.findMany({ where: { incidentId }, orderBy: { startedAt: "asc" } }),
    db.agentTask.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" } }),
    db.approval.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true, email: true } } } }),
    db.activityEvent.findMany({ where: { incidentId }, orderBy: { seq: "desc" }, take: 300 }),
  ]);
  const latest = (stage: string) => {
    const t = [...tasks].reverse().find((x) => x.stage === stage && x.status === "COMPLETED");
    return t ? { taskId: t.id, attempt: t.attempt, completedAt: t.completedAt, ...(t.result as Record<string, unknown>) } : null;
  };
  const r = incident.repository;
  return {
    incident: {
      ...incident,
      repository: { id: r.id, fullName: r.fullName, provider: r.provider, defaultBranch: r.defaultBranch, htmlUrl: r.htmlUrl, visibility: r.visibility },
      workspacePath: incident.workspacePath,
    },
    agents,
    messages,
    evidence,
    changes,
    testRuns,
    tasks: tasks.map((t) => ({ id: t.id, agentId: t.agentId, stage: t.stage, attempt: t.attempt, title: t.title, status: t.status, error: t.error, startedAt: t.startedAt, completedAt: t.completedAt })),
    reports: { triage: latest("triage"), investigation: latest("investigation"), fix: latest("fix"), qa: latest("qa"), qaHistory: tasks.filter((t) => t.stage === "qa" && t.status === "COMPLETED").map((t) => ({ attempt: t.attempt, ...(t.result as Record<string, unknown>) })) },
    approvals,
    events: events.reverse().map(toStreamEvent),
  };
}

export type IncidentDetail = Awaited<ReturnType<typeof incidentDetail>>;
