import { HttpError, requireUser, requireWorkspaceMember } from "@/src/lib/auth/session";
import { route } from "@/src/lib/http";
import { eventStream } from "@/src/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Workspace-wide live activity (dashboard). */
export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) throw new HttpError(400, "workspaceId is required", "missing_workspace");
  await requireWorkspaceMember(user.id, workspaceId);
  return eventStream(req, { workspaceId });
});
