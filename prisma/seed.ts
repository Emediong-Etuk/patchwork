/**
 * Seeds a demo user (demo@patchwork.dev), their workspace, the bundled demo
 * repository and the four agent records. No incidents are pre-made: run the
 * demo scenario to see real agent work.
 */
import { db } from "@/src/lib/database/client";
import { seedAgents } from "@/src/orchestration/runtime";
import { ensureDefaultWorkspace } from "@/src/services/workspaces";

async function main() {
  await seedAgents();
  const user = await db.user.upsert({ where: { email: "demo@patchwork.dev" }, create: { email: "demo@patchwork.dev", name: "Demo Developer" }, update: {} });
  const ws = await ensureDefaultWorkspace(user);
  const repos = await db.repository.findMany({ where: { workspaceId: ws.id } });
  console.log(`Seeded user ${user.email}, workspace "${ws.name}", repositories: ${repos.map((r) => r.fullName).join(", ")}, and 4 agents.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
