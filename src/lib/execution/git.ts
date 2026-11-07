import { execFile } from "child_process";

export type GitResult = { stdout: string; stderr: string };

const BASE_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/tmp",
  LANG: "C.UTF-8",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "PATCHWORK_Fixer",
  GIT_AUTHOR_EMAIL: "patchwork-fixer@users.noreply.patchwork.local",
  GIT_COMMITTER_NAME: "PATCHWORK_Fixer",
  GIT_COMMITTER_EMAIL: "patchwork-fixer@users.noreply.patchwork.local",
};

/**
 * Run git with argv (never a shell). `auth` injects a GitHub token through
 * GIT_CONFIG_* environment variables, so it is never written to .git/config,
 * never appears in argv, and never reaches agent-visible output.
 */
export function git(cwd: string, args: string[], opts: { auth?: { host: string; token: string }; timeoutMs?: number } = {}): Promise<GitResult> {
  const env: Record<string, string> = { ...BASE_ENV };
  // Inherit proxy settings so clones work behind corporate proxies.
  for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy", "GIT_SSL_CAINFO", "SSL_CERT_FILE"]) {
    if (process.env[k]) env[k] = process.env[k]!;
  }
  if (opts.auth) {
    const basic = Buffer.from(`x-access-token:${opts.auth.token}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = `http.https://${opts.auth.host}/.extraheader`;
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  }
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: opts.timeoutMs ?? 120_000, maxBuffer: 20 * 1024 * 1024 }, (err: Error | null, stdout: string, stderr: string) => {
      if (err) {
        const e = new Error(`git ${args[0]} failed: ${(stderr || err.message).trim().slice(0, 2000)}`);
        reject(e);
      } else resolve({ stdout, stderr });
    });
  });
}
