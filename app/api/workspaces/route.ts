import { z } from "zod";
import { requireUser } from "@/src/lib/auth/session";
import { json, parseBody, route } from "@/src/lib/http";
import { createWorkspace, listWorkspaces } from "@/src/services/workspaces";

export const GET = route(async () => {
  const user = await requireUser();
  return json({ workspaces: await listWorkspaces(user.id) });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(2).max(60) }));
  return json({ workspace: await createWorkspace(user, name) }, 201);
});
