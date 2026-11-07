import { z } from "zod";
import { HttpError, requireUser } from "@/src/lib/auth/session";
import { json, parseBody, route } from "@/src/lib/http";
import { github, GitHubError } from "@/src/lib/github/client";
import { deleteGitHubToken, saveGitHubToken } from "@/src/lib/github/tokens";

/** Connect GitHub with a fine-grained personal access token (stored encrypted). */
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const { token } = await parseBody(req, z.object({ token: z.string().trim().min(20).max(400) }));
  let viewer;
  try {
    viewer = await github.viewer(token);
  } catch (e) {
    throw new HttpError(400, e instanceof GitHubError ? e.message : "Could not verify the token with GitHub", "github_token_invalid");
  }
  await saveGitHubToken(user.id, token, viewer.login);
  return json({ github: { login: viewer.login } });
});

export const DELETE = route(async () => {
  const user = await requireUser();
  await deleteGitHubToken(user.id);
  return json({ ok: true });
});
