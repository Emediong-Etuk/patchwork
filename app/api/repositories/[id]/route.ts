import { db } from "@/src/lib/database/client";
import { HttpError, requireUser, requireWorkspaceMember } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { github } from "@/src/lib/github/client";
import { getGitHubToken } from "@/src/lib/github/tokens";

type Ctx = { params: Promise<{ id: string }> };

async function load(userId: string, id: string) {
  const repo = await db.repository.findUnique({ where: { id } });
  if (!repo) throw new HttpError(404, "Repository not found", "not_found");
  await requireWorkspaceMember(userId, repo.workspaceId);
  return repo;
}

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const repo = await load(user.id, (await params).id);
  const incidents = await db.incident.findMany({ where: { repositoryId: repo.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, number: true, title: true, status: true, severity: true, createdAt: true } });
  let recentCommits: { sha: string; message: string; author: string; date: string }[] = [];
  let live: { error?: string } = {};
  if (repo.provider === "GITHUB") {
    const token = (await getGitHubToken(user.id))?.token ?? null;
    try {
      const commits = await github.listCommits(token, repo.fullName, repo.defaultBranch);
      recentCommits = commits.map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0], author: c.commit.author.name, date: c.commit.author.date }));
    } catch (e) {
      live = { error: (e as Error).message };
    }
  }
  return json({ repository: { ...repo, localPath: repo.provider === "LOCAL" ? repo.localPath : null }, incidents, recentCommits, live });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const repo = await load(user.id, (await params).id);
  const active = await db.incident.count({ where: { repositoryId: repo.id, status: { in: ["TRIAGING", "INVESTIGATING", "FIXING", "TESTING"] } } });
  if (active) throw new HttpError(409, "This repository has active investigations; cancel them first", "active_incidents");
  // Incidents keep their history, so the repository is marked disconnected rather than deleted.
  const updated = await db.repository.update({ where: { id: repo.id }, data: { connectionStatus: "DISCONNECTED" } });
  return json({ repository: updated });
});
