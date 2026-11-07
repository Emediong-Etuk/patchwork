/**
 * Minimal GitHub REST client. Tokens are passed in per call from encrypted
 * storage and never handed to agents.
 */
import { config } from "@/src/lib/config";

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export type GhRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  private: boolean;
  visibility?: string;
  description: string | null;
  html_url: string;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  pushed_at?: string;
};

export type GhPull = { number: number; html_url: string; state: string; merged: boolean | null; draft?: boolean; title: string; head: { ref: string }; base: { ref: string } };

async function gh<T>(token: string | null, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config().GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "patchwork-app",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      /* ignore */
    }
    const hint = res.status === 401 ? " (token invalid or expired)" : res.status === 403 ? " (token lacks permission or rate limited)" : res.status === 404 ? " (not found or no access)" : "";
    throw new GitHubError(`GitHub ${init.method ?? "GET"} ${path} failed: ${res.status}${hint}${detail ? ` - ${detail}` : ""}`, res.status);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export const github = {
  viewer: (token: string) => gh<{ login: string; name: string | null; avatar_url: string }>(token, "/user"),
  listRepos: (token: string, page = 1) => gh<GhRepo[]>(token, `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`),
  getRepo: (token: string | null, fullName: string) => gh<GhRepo>(token, `/repos/${fullName}`),
  listCommits: (token: string | null, fullName: string, sha: string) => gh<{ sha: string; commit: { message: string; author: { name: string; date: string } } }[]>(token, `/repos/${fullName}/commits?sha=${encodeURIComponent(sha)}&per_page=5`),
  createPull: (token: string, fullName: string, input: { title: string; head: string; base: string; body: string; draft?: boolean }) =>
    gh<GhPull>(token, `/repos/${fullName}/pulls`, { method: "POST", body: JSON.stringify({ ...input, maintainer_can_modify: true }) }),
  getPull: (token: string | null, fullName: string, number: number) => gh<GhPull>(token, `/repos/${fullName}/pulls/${number}`),
  exchangeOAuthCode: async (code: string) => {
    const c = config();
    if (!c.GITHUB_CLIENT_ID || !c.GITHUB_CLIENT_SECRET) throw new GitHubError("GitHub OAuth is not configured", 500);
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: c.GITHUB_CLIENT_ID, client_secret: c.GITHUB_CLIENT_SECRET, code }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json()) as { access_token?: string; error_description?: string };
    if (!body.access_token) throw new GitHubError(`GitHub OAuth failed: ${body.error_description ?? res.status}`, 400);
    return body.access_token;
  },
};
