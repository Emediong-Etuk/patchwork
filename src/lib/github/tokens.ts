import { db } from "@/src/lib/database/client";
import { decryptSecret, encryptSecret } from "@/src/lib/security/crypto";
import { registerSecret } from "@/src/lib/security/redact";

const KIND = "GITHUB_TOKEN";

export async function saveGitHubToken(userId: string, token: string, login: string) {
  const ciphertext = encryptSecret(JSON.stringify({ token, login }));
  await db.credential.upsert({
    where: { kind_scope: { kind: KIND, scope: `user:${userId}` } },
    create: { kind: KIND, scope: `user:${userId}`, userId, ciphertext },
    update: { ciphertext },
  });
}

export async function getGitHubToken(userId: string): Promise<{ token: string; login: string } | null> {
  const row = await db.credential.findUnique({ where: { kind_scope: { kind: KIND, scope: `user:${userId}` } } });
  if (!row) return null;
  const value = JSON.parse(decryptSecret(row.ciphertext)) as { token: string; login: string };
  registerSecret(value.token);
  return value;
}

export async function deleteGitHubToken(userId: string) {
  await db.credential.deleteMany({ where: { kind: KIND, scope: `user:${userId}` } });
}

/** Token of any member of the workspace's owner, used for background clones. */
export async function getWorkspaceGitHubToken(workspaceId: string): Promise<string | null> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, include: { members: true } });
  if (!ws) return null;
  const ids = [ws.ownerId, ...ws.members.map((m) => m.userId)];
  for (const id of ids) {
    const t = await getGitHubToken(id);
    if (t) return t.token;
  }
  return null;
}
