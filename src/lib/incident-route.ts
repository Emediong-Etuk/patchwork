import { requireIncidentAccess, requireUser } from "@/src/lib/auth/session";

export type IdCtx = { params: Promise<{ id: string }> };

export async function incidentContext(ctx: IdCtx) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const incident = await requireIncidentAccess(user.id, id);
  return { user, incident };
}
