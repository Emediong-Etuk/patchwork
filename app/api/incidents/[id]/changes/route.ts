import { db } from "@/src/lib/database/client";
import { json, route } from "@/src/lib/http";
import { incidentContext, type IdCtx } from "@/src/lib/incident-route";

export const GET = route(async (_req: Request, ctx: IdCtx) => {
  const { incident } = await incidentContext(ctx);
  return json({ changes: await db.codeChange.findMany({ where: { incidentId: incident.id }, orderBy: [{ attempt: "asc" }, { filePath: "asc" }] }), branch: incident.workingBranch, baseCommit: incident.baseCommit, headCommit: incident.headCommit });
});
