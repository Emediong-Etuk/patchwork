import path from "path";
import type { User } from "@prisma/client";
import { db } from "@/src/lib/database/client";

export const DEMO_REPO_FULL_NAME = "patchwork-demo/broken-registration-app";

export function demoRepositoryPath() {
  return path.resolve(process.env.PATCHWORK_DEMO_REPO_PATH ?? path.join(process.cwd(), "demo/broken-registration-app"));
}

/** Every user gets a workspace; new workspaces include the local demo repository. */
export async function ensureDefaultWorkspace(user: User) {
  const existing = await db.workspaceMember.findFirst({ where: { userId: user.id }, include: { workspace: true }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.workspace;
  const ws = await db.workspace.create({
    data: { name: `${user.name.split(" ")[0]}'s workspace`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
  });
  await addDemoRepository(ws.id);
  return ws;
}

export async function addDemoRepository(workspaceId: string) {
  return db.repository.upsert({
    where: { workspaceId_provider_fullName: { workspaceId, provider: "LOCAL", fullName: DEMO_REPO_FULL_NAME } },
    create: {
      workspaceId,
      provider: "LOCAL",
      owner: "patchwork-demo",
      name: "broken-registration-app",
      fullName: DEMO_REPO_FULL_NAME,
      defaultBranch: "main",
      visibility: "local",
      description: "Demo account service with a deliberately broken registration endpoint (HTTP 500). Bundled with PATCHWORK.",
      localPath: demoRepositoryPath(),
      testCommand: "npm test",
    },
    update: { localPath: demoRepositoryPath(), connectionStatus: "CONNECTED" },
  });
}

export async function listWorkspaces(userId: string) {
  return db.workspace.findMany({ where: { members: { some: { userId } } }, orderBy: { createdAt: "asc" }, include: { _count: { select: { incidents: true, repositories: true } } } });
}

export async function createWorkspace(user: User, name: string) {
  const ws = await db.workspace.create({ data: { name, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } } });
  await addDemoRepository(ws.id);
  return ws;
}
