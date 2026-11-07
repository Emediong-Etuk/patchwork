import { requireUser } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { getGitHubToken } from "@/src/lib/github/tokens";
import { listWorkspaces } from "@/src/services/workspaces";

export const GET = route(async () => {
  const user = await requireUser();
  const gh = await getGitHubToken(user.id).catch(() => null);
  return json({ user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar }, github: gh ? { login: gh.login } : null, workspaces: await listWorkspaces(user.id) });
});
