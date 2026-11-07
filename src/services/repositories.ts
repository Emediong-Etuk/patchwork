import type { User } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { HttpError, requireWorkspaceMember } from "@/src/lib/auth/session";
import { github, GitHubError } from "@/src/lib/github/client";
import { getGitHubToken } from "@/src/lib/github/tokens";

export async function listRepositories(userId: string, workspaceId: string) {
  await requireWorkspaceMember(userId, workspaceId);
  const repos = await db.repository.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { incidents: true } } } });
  const active = await db.incident.groupBy({ by: ["repositoryId"], where: { workspaceId, status: { notIn: ["RESOLVED", "CANCELLED", "REJECTED"] } }, _count: true });
  return repos.map((r) => ({ ...r, localPath: r.provider === "LOCAL" ? r.localPath : null, activeIncidents: active.find((a) => a.repositoryId === r.id)?._count ?? 0 }));
}

export async function connectGitHubRepository(user: User, workspaceId: string, fullName: string) {
  await requireWorkspaceMember(user.id, workspaceId);
  const gh = await getGitHubToken(user.id);
  if (!gh) throw new HttpError(400, "Connect GitHub first", "github_not_connected");
  let repo;
  try {
    repo = await github.getRepo(gh.token, fullName);
  } catch (e) {
    if (e instanceof GitHubError) throw new HttpError(e.status === 404 ? 404 : 502, e.message, "github_error");
    throw e;
  }
  if (!repo.permissions?.pull) throw new HttpError(403, "Your GitHub token cannot read this repository", "github_permission");
  return db.repository.upsert({
    where: { workspaceId_provider_fullName: { workspaceId, provider: "GITHUB", fullName: repo.full_name } },
    create: {
      workspaceId,
      provider: "GITHUB",
      externalRepositoryId: String(repo.id),
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      visibility: repo.visibility ?? (repo.private ? "private" : "public"),
      description: repo.description,
      htmlUrl: repo.html_url,
    },
    update: { defaultBranch: repo.default_branch, visibility: repo.visibility ?? (repo.private ? "private" : "public"), description: repo.description, htmlUrl: repo.html_url, connectionStatus: "CONNECTED" },
  });
}
