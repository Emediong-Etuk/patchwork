import { db } from "@/src/lib/database/client";
import { requireUser, requireWorkspaceMember } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await params;
  await requireWorkspaceMember(user.id, id);
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id }, include: { members: { include: { user: { select: { id: true, name: true, email: true } } } }, _count: { select: { incidents: true, repositories: true } } } });
  return json({ workspace });
});
