import { json, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { incidentDetail } from "@/src/services/incident-detail";

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: IdCtx) => {
  const { incident } = await incidentContext(ctx);
  return json(await incidentDetail(incident.id));
});
