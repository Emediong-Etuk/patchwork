import type { User } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { emitEvent } from "@/src/lib/events/bus";
import { HttpError, requireWorkspaceMember } from "@/src/lib/auth/session";
import { redact } from "@/src/lib/security/redact";
import { config } from "@/src/lib/config";
import type { CreateIncidentInput } from "@/src/schemas/incident";
import { ensureRuntime } from "@/src/orchestration/runtime";
import { startIncident } from "@/src/orchestration/workflow";

export async function createIncident(user: User, input: CreateIncidentInput) {
  await requireWorkspaceMember(user.id, input.workspaceId);
  const repo = await db.repository.findFirst({ where: { id: input.repositoryId, workspaceId: input.workspaceId } });
  if (!repo) throw new HttpError(400, "Repository not found in this workspace", "invalid_repository");
  if (repo.connectionStatus !== "CONNECTED") throw new HttpError(400, "Repository is disconnected", "repository_disconnected");

  const incident = await db.incident.create({
    data: {
      workspaceId: input.workspaceId,
      repositoryId: repo.id,
      title: redact(input.title),
      description: redact(input.description),
      errorMessage: input.errorMessage ? redact(input.errorMessage) : null,
      stackTrace: input.stackTrace ? redact(input.stackTrace) : null,
      reproductionSteps: input.reproductionSteps ? redact(input.reproductionSteps) : null,
      maxFixAttempts: config().MAX_FIX_ATTEMPTS,
    },
  });
  await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "USER", actorId: user.id, eventType: "INCIDENT_CREATED", description: `${user.name} reported INC-${incident.number}: ${incident.title}`, metadata: { repository: repo.fullName } });
  if (input.autoStart) {
    await ensureRuntime();
    await startIncident(incident.id);
  }
  return db.incident.findUniqueOrThrow({ where: { id: incident.id } });
}

export async function listIncidents(userId: string, filter: { workspaceId?: string; repositoryId?: string; status?: string } = {}) {
  return db.incident.findMany({
    where: {
      workspace: { members: { some: { userId } } },
      ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
      ...(filter.repositoryId ? { repositoryId: filter.repositoryId } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { repository: { select: { fullName: true, provider: true } }, tasks: { where: { status: "RUNNING" }, select: { agentId: true, title: true } } },
  });
}

/** Per-incident status of each agent, derived from its tasks there. */
export async function incidentAgentStatuses(incidentId: string) {
  const [agents, tasks, incident] = await Promise.all([
    db.agent.findMany({ orderBy: { id: "asc" } }),
    db.agentTask.findMany({ where: { incidentId }, orderBy: { createdAt: "asc" } }),
    db.incident.findUniqueOrThrow({ where: { id: incidentId } }),
  ]);
  const waitingOn: Record<string, string> = { TRIAGING: "agent_triage", INVESTIGATING: "agent_investigator", FIXING: "agent_fixer", TESTING: "agent_qa" };
  return agents.map((a) => {
    const mine = tasks.filter((t) => t.agentId === a.id && t.stage !== "consult");
    const last = mine[mine.length - 1];
    let status: "IDLE" | "WORKING" | "WAITING" | "COMPLETED" | "FAILED" = "IDLE";
    if (last?.status === "RUNNING") status = "WORKING";
    else if (waitingOn[incident.status] === a.id) status = "WAITING";
    else if (last?.status === "FAILED") status = "FAILED";
    else if (last?.status === "COMPLETED") status = "COMPLETED";
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      title: a.title,
      model: a.model,
      status,
      currentTask: last?.status === "RUNNING" ? last.title : status === "WAITING" ? "Waiting for the handoff via Switch" : last ? last.title : null,
      lastActivity: last ? (last.completedAt ?? last.startedAt ?? last.createdAt).toISOString() : null,
      tasksCompleted: mine.filter((t) => t.status === "COMPLETED").length,
    };
  });
}
