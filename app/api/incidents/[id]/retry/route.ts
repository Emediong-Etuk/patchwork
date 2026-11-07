import { HttpError } from "@/src/lib/auth/session";
import { json, parseBody, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { ensureRuntime } from "@/src/orchestration/runtime";
import { retryIncident } from "@/src/orchestration/workflow";
import { retrySchema } from "@/src/schemas/incident";

export const POST = route(async (req: Request, ctx: IdCtx) => {
  const { user, incident } = await incidentContext(ctx);
  const { guidance } = await parseBody(req, retrySchema);
  await ensureRuntime();
  if (!(await retryIncident(incident.id, user, guidance))) throw new HttpError(409, `Incident is ${incident.status} and cannot be retried`, "invalid_state");
  return json({ ok: true });
});
