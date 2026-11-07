import { db } from "@/src/lib/database/client";
import { json, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";

export const GET = route(async (_req: Request, ctx: IdCtx) => {
  const { incident } = await incidentContext(ctx);
  return json({ messages: await db.agentMessage.findMany({ where: { incidentId: incident.id }, orderBy: { createdAt: "asc" } }), room: { id: incident.switchRoomId, name: incident.switchRoomName, mode: incident.switchMode } });
});
