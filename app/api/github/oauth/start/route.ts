import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { config } from "@/src/lib/config";
import { requireUser } from "@/src/lib/auth/session";
import { route, json } from "@/src/lib/http";

export const GET = route(async () => {
  await requireUser();
  const c = config();
  if (!c.GITHUB_CLIENT_ID) return json({ error: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or connect with a personal access token." }, 400);
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("pw_gh_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${c.APP_URL}/api/github/oauth/callback`);
  url.searchParams.set("scope", "repo");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
});
