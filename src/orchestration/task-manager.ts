import type { AgentRole, Prisma } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { emitEvent } from "@/src/lib/events/bus";
import { AGENT_PROFILES } from "@/src/agents/registry";

export function agentIdFor(role: AgentRole) {
  return AGENT_PROFILES[role].id;
}

/**
 * Claim a task by idempotency key. Returns null if the task already exists
 * (a duplicate Switch delivery or a retried handoff), so work never runs twice.
 */
export async function claimTask(input: { incidentId: string; workspaceId: string; role: AgentRole; key: string; stage: string; attempt: number; title: string; description: string }) {
  const agentId = agentIdFor(input.role);
  try {
    const task = await db.agentTask.create({
      data: { incidentId: input.incidentId, agentId, key: input.key, stage: input.stage, attempt: input.attempt, title: input.title, description: input.description, status: "RUNNING", startedAt: new Date() },
    });
    await db.agent.update({ where: { id: agentId }, data: { status: "WORKING", currentTask: input.title, lastActiveAt: new Date() } });
    await emitEvent({ incidentId: input.incidentId, workspaceId: input.workspaceId, actorType: "AGENT", actorId: agentId, eventType: "AGENT_STATUS_CHANGED", description: `${roleName(input.role)} started: ${input.title}`, metadata: { status: "WORKING", taskId: task.id, stage: input.stage, attempt: input.attempt } });
    return task;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
}

export async function completeTask(taskId: string, role: AgentRole, result: unknown, ctx: { incidentId: string; workspaceId: string }) {
  await db.agentTask.update({ where: { id: taskId }, data: { status: "COMPLETED", result: result as Prisma.InputJsonValue, completedAt: new Date() } });
  await settleAgent(role, "COMPLETED", ctx, "completed its task");
}

export async function failTask(taskId: string, role: AgentRole, error: string, ctx: { incidentId: string; workspaceId: string }) {
  await db.agentTask.update({ where: { id: taskId }, data: { status: "FAILED", error: error.slice(0, 4000), completedAt: new Date() } });
  await settleAgent(role, "FAILED", ctx, `failed: ${error.slice(0, 200)}`);
}

async function settleAgent(role: AgentRole, status: "COMPLETED" | "FAILED", ctx: { incidentId: string; workspaceId: string }, text: string) {
  const agentId = agentIdFor(role);
  const stillRunning = await db.agentTask.count({ where: { agentId, status: "RUNNING" } });
  await db.agent.update({ where: { id: agentId }, data: { status: stillRunning ? "WORKING" : "IDLE", currentTask: stillRunning ? undefined : null, lastActiveAt: new Date() } });
  await emitEvent({ incidentId: ctx.incidentId, workspaceId: ctx.workspaceId, actorType: "AGENT", actorId: agentId, eventType: "AGENT_STATUS_CHANGED", description: `${roleName(role)} ${text}`, metadata: { status } });
}

export function roleName(role: AgentRole) {
  return { TRIAGE: "PATCHWORK_Triage", INVESTIGATOR: "PATCHWORK_Investigator", FIXER: "PATCHWORK_Fixer", QA: "PATCHWORK_QA" }[role];
}
