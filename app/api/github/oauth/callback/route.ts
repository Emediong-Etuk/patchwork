import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "@/src/lib/config";
import { requireUser } from "@/src/lib/auth/session";
import { github } from "@/src/lib/github/client";
import { saveGitHubToken } from "@/src/lib/github/tokens";

export async function GET(req: Request) {
  const base = config().APP_URL;
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const state = (await cookies()).get("pw_gh_state")?.value;
    if (!state || state !== url.searchParams.get("state")) return NextResponse.redirect(`${base}/repositories?github=state_mismatch`);
    const token = await github.exchangeOAuthCode(url.searchParams.get("code") ?? "");
    const viewer = await github.viewer(token);
    await saveGitHubToken(user.id, token, viewer.login);
    (await cookies()).delete("pw_gh_state");
    return NextResponse.redirect(`${base}/repositories?github=connected`);
  } catch (e) {
    return NextResponse.redirect(`${base}/repositories?github=error&message=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}
