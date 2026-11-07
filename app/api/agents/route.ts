import { db } from "@/src/lib/database/client";
import { requireUser } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { getSwitch } from "@/src/lib/switch";
import { ensureRuntime } from "@/src/orchestration/runtime";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  await ensureRuntime().catch(() => undefined);
  const sw = getSwitch().status();
  const order = ["TRIAGE", "INVESTIGATOR", "FIXER", "QA"];
  const agents = (await db.agent.findMany()).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const visible = { incident: { workspace: { members: { some: { userId: user.id } } } } };
  const out = await Promise.all(
    agents.map(async (a) => {
      const [completed, failed, recent] = await Promise.all([
        db.agentTask.count({ where: { agentId: a.id, status: "COMPLETED", ...visible } }),
        db.agentTask.count({ where: { agentId: a.id, status: "FAILED", ...visible } }),
        db.agentTask.findMany({ where: { agentId: a.id, ...visible }, orderBy: { createdAt: "desc" }, take: 8, include: { incident: { select: { id: true, number: true, title: true } } } }),
      ]);
      const identity = sw.identities.find((i) => i.key === a.role);
      return { ...a, tasksCompleted: completed, tasksFailed: failed, recent: recent.map((t) => ({ id: t.id, title: t.title, status: t.status, stage: t.stage, attempt: t.attempt, createdAt: t.createdAt, completedAt: t.completedAt, incident: t.incident })), switch: identity ? { name: identity.name, agentId: identity.agentId, state: identity.connection?.state ?? "not connected", mode: sw.mode } : null };
    }),
  );
  return json({ agents: out });
});
