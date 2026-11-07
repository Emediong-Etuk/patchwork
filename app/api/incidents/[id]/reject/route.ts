import { json, parseBody, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { rejectFix } from "@/src/orchestration/approval";
import { rejectSchema } from "@/src/schemas/incident";

export const POST = route(async (req: Request, ctx: IdCtx) => {
  const { user, incident } = await incidentContext(ctx);
  const { reason } = await parseBody(req, rejectSchema);
  return json({ incident: await rejectFix(incident.id, user, reason) });
});
