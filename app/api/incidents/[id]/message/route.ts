import { HttpError } from "@/src/lib/auth/session";
import { json, parseBody, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { ensureRuntime } from "@/src/orchestration/runtime";
import { postHumanMessage } from "@/src/orchestration/workflow";
import { humanMessageSchema } from "@/src/schemas/incident";

export const POST = route(async (req: Request, ctx: IdCtx) => {
  const { user, incident } = await incidentContext(ctx);
  const { content, target } = await parseBody(req, humanMessageSchema);
  if (incident.status === "CANCELLED") throw new HttpError(409, "This incident is cancelled", "invalid_state");
  await ensureRuntime();
  try {
    return json({ message: await postHumanMessage(incident.id, user, content, target) }, 201);
  } catch (e) {
    throw new HttpError(502, `Message could not be delivered to the Switch room: ${(e as Error).message}`, "switch_delivery_failed");
  }
});
