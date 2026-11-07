import { rmSync } from "fs";
import path from "path";
import { db } from "@/src/lib/database/client";
import { ensureDefaultWorkspace } from "@/src/services/workspaces";
import { seedAgents } from "@/src/orchestration/runtime";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "ActivityEvent","Approval","TestRun","CodeChange","Evidence","AgentMessage","AgentTask","Incident","Repository","WorkspaceMember","Workspace","Credential","User","SystemState" RESTART IDENTITY CASCADE',
  );
  rmSync(path.resolve("tests/.tmp/workspaces"), { recursive: true, force: true });
  await seedAgents();
}

export async function makeUser(email = "dev@example.com", name = "Dana Developer") {
  const user = await db.user.create({ data: { email, name } });
  const workspace = await ensureDefaultWorkspace(user);
  const repo = await db.repository.findFirstOrThrow({ where: { workspaceId: workspace.id } });
  return { user, workspace, repo };
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, { timeoutMs = 30_000, intervalMs = 100, label = "condition" } = {}): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function waitForStatus(incidentId: string, statuses: string[], timeoutMs = 45_000) {
  return waitFor(
    async () => {
      const i = await db.incident.findUnique({ where: { id: incidentId } });
      return i && statuses.includes(i.status) ? i : null;
    },
    { timeoutMs, label: `incident status in ${statuses.join("/")}` },
  );
}
