import { db } from "@/src/lib/database/client";
import { HttpError, requireUser, requireWorkspaceMember } from "@/src/lib/auth/session";
import { toStreamEvent } from "@/src/lib/events/bus";
import { json, route } from "@/src/lib/http";

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const p = new URL(req.url).searchParams;
  const workspaceId = p.get("workspaceId");
  if (!workspaceId) throw new HttpError(400, "workspaceId is required", "missing_workspace");
  await requireWorkspaceMember(user.id, workspaceId);
  const types = p.get("types")?.split(",").filter(Boolean);
  const rows = await db.activityEvent.findMany({ where: { workspaceId, ...(types?.length ? { eventType: { in: types } } : {}) }, orderBy: { seq: "desc" }, take: Math.min(Number(p.get("limit") ?? 100), 500), include: { incident: { select: { number: true, title: true } } } });
  return json({ events: rows.map((r) => ({ ...toStreamEvent(r), incident: r.incident })) });
});
