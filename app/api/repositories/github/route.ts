import { HttpError, requireUser } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { github } from "@/src/lib/github/client";
import { getGitHubToken } from "@/src/lib/github/tokens";

/** Repositories the signed-in user's GitHub token can see. */
export const GET = route(async () => {
  const user = await requireUser();
  const gh = await getGitHubToken(user.id);
  if (!gh) throw new HttpError(400, "Connect GitHub first", "github_not_connected");
  const repos = await github.listRepos(gh.token);
  return json({ repositories: repos.map((r) => ({ id: r.id, fullName: r.full_name, owner: r.owner.login, name: r.name, defaultBranch: r.default_branch, visibility: r.visibility ?? (r.private ? "private" : "public"), description: r.description, pushedAt: r.pushed_at, canPush: !!r.permissions?.push })) });
});
