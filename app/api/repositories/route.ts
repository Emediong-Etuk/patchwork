import { requireUser } from "@/src/lib/auth/session";
import { HttpError } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { listRepositories } from "@/src/services/repositories";

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) throw new HttpError(400, "workspaceId is required", "missing_workspace");
  return json({ repositories: await listRepositories(user.id, workspaceId) });
});
