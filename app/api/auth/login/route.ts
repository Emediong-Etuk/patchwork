import { z } from "zod";
import { db } from "@/src/lib/database/client";
import { config } from "@/src/lib/config";
import { HttpError, setSessionCookie } from "@/src/lib/auth/session";
import { constantTimeEqual } from "@/src/lib/security/crypto";
import { json, parseBody, route } from "@/src/lib/http";
import { ensureDefaultWorkspace } from "@/src/services/workspaces";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(80),
  accessCode: z.string().min(1),
});

/** Demo access: anyone with the deployment's access code can sign in by email. */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, schema);
  if (!constantTimeEqual(body.accessCode, config().PATCHWORK_ACCESS_CODE)) throw new HttpError(401, "Incorrect access code", "bad_access_code");
  const user = await db.user.upsert({ where: { email: body.email }, create: { email: body.email, name: body.name }, update: {} });
  const workspace = await ensureDefaultWorkspace(user);
  await setSessionCookie(user.id);
  return json({ user: { id: user.id, email: user.email, name: user.name }, workspaceId: workspace.id });
});
