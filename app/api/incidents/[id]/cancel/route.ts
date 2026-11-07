import { HttpError } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { cancelIncident } from "@/src/orchestration/workflow";

export const POST = route(async (_req: Request, ctx: IdCtx) => {
  const { user, incident } = await incidentContext(ctx);
  if (!(await cancelIncident(incident.id, user))) throw new HttpError(409, `Incident is already ${incident.status}`, "invalid_state");
  return json({ ok: true });
});
