import { json, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";
import { createPullRequest } from "@/src/orchestration/approval";

/** Retry pull request creation for an approved fix. Never merges. */
export const POST = route(async (_req: Request, ctx: IdCtx) => {
  const { user, incident } = await incidentContext(ctx);
  return json({ incident: await createPullRequest(incident.id, user) });
});
