import { HttpError } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { ensureRuntime } from "@/src/orchestration/runtime";
import { startIncident } from "@/src/orchestration/workflow";

export const POST = route(async (_req: Request, ctx: IdCtx) => {
  const { incident } = await incidentContext(ctx);
  await ensureRuntime();
  if (!(await startIncident(incident.id))) throw new HttpError(409, `Incident is ${incident.status}; only NEW incidents can be started (use retry for failed ones)`, "invalid_state");
  return json({ ok: true });
});
