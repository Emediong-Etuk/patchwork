import { db } from "@/src/lib/database/client";
import { HttpError, requireUser } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { AGENTS } from "@/src/agents/registry";
import { systemPrompt } from "@/src/agents/base/agent";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const agent = await db.agent.findUnique({ where: { id: (await params).id } });
  if (!agent) throw new HttpError(404, "Agent not found", "not_found");
  const tasks = await db.agentTask.findMany({ where: { agentId: agent.id, incident: { workspace: { members: { some: { userId: user.id } } } } }, orderBy: { createdAt: "desc" }, take: 30, include: { incident: { select: { id: true, number: true, title: true } } } });
  return json({ agent, instructions: systemPrompt(AGENTS[agent.role]), tasks });
});
