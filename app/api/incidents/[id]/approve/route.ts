import { json, parseBody, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { approveFix } from "@/src/orchestration/approval";
import { approveSchema } from "@/src/schemas/incident";

export const POST = route(async (req: Request, ctx: IdCtx) => {
  const { user, incident } = await incidentContext(ctx);
  const body = await parseBody(req, approveSchema);
  return json({ incident: await approveFix(incident.id, user, body) });
});
