import { route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { eventStream } from "@/src/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(async (req: Request, ctx: IdCtx) => {
  const { incident } = await incidentContext(ctx);
  return eventStream(req, { incidentId: incident.id });
});
