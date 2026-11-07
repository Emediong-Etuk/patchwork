import { z } from "zod";
import { requireUser } from "@/src/lib/auth/session";
import { json, parseBody, route } from "@/src/lib/http";
import { connectGitHubRepository } from "@/src/services/repositories";
import { addDemoRepository } from "@/src/services/workspaces";
import { requireWorkspaceMember } from "@/src/lib/auth/session";

const schema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("GITHUB"), workspaceId: z.string().min(1), fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Use owner/name") }),
  z.object({ provider: z.literal("DEMO"), workspaceId: z.string().min(1) }),
]);

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = await parseBody(req, schema);
  if (body.provider === "DEMO") {
    await requireWorkspaceMember(user.id, body.workspaceId);
    return json({ repository: await addDemoRepository(body.workspaceId) }, 201);
  }
  return json({ repository: await connectGitHubRepository(user, body.workspaceId, body.fullName) }, 201);
});
