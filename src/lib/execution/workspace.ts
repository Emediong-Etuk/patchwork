/**
 * Repository workspaces. Each incident gets its own directory under
 * PATCHWORK_WORKSPACES_DIR and its own branch `patchwork/incident-<n>-fix`.
 * The default branch is never modified.
 */
import { promises as fs } from "fs";
import path from "path";
import type { Repository } from "@prisma/client";
import { config } from "@/src/lib/config";
import { git } from "./git";

export type PreparedWorkspace = { dir: string; branch: string; baseCommit: string; reused: boolean };

export function workingBranchName(incidentNumber: number) {
  return `patchwork/incident-${incidentNumber}-fix`;
}

export function workspaceDir(incidentId: string) {
  return path.resolve(config().PATCHWORK_WORKSPACES_DIR, incidentId);
}

const COPY_EXCLUDE = new Set([".git", "node_modules", ".next", "dist", "coverage", ".patchwork"]);

export async function prepareWorkspace(
  incident: { id: string; number: number },
  repository: Repository,
  githubToken: string | null,
): Promise<PreparedWorkspace> {
  const dir = workspaceDir(incident.id);
  const branch = workingBranchName(incident.number);

  // Idempotent: a retried workflow reuses the existing checkout.
  if (await exists(path.join(dir, ".git"))) {
    const head = (await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    if (head !== branch) await git(dir, ["checkout", branch]);
    const baseCommit = (await git(dir, ["rev-parse", repository.defaultBranch])).stdout.trim();
    return { dir, branch, baseCommit, reused: true };
  }

  await fs.mkdir(path.dirname(dir), { recursive: true });
  await fs.rm(dir, { recursive: true, force: true });

  if (repository.provider === "LOCAL") {
    if (!repository.localPath) throw new Error("Local repository has no path configured");
    const src = path.resolve(repository.localPath);
    if (!(await exists(src))) throw new Error(`Local repository path does not exist: ${src}`);
    await fs.cp(src, dir, { recursive: true, filter: (p) => !COPY_EXCLUDE.has(path.basename(p)) });
    await git(dir, ["init", "-q", "-b", repository.defaultBranch]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", `Baseline snapshot of ${repository.fullName}`]);
  } else {
    if (!githubToken && repository.visibility !== "public") throw new Error("GitHub is not connected; cannot clone a private repository");
    await git(path.dirname(dir), ["clone", "-q", "--depth", "50", "--branch", repository.defaultBranch, `https://github.com/${repository.fullName}.git`, dir], {
      auth: githubToken ? { host: "github.com", token: githubToken } : undefined,
      timeoutMs: 300_000,
    });
  }

  const baseCommit = (await git(dir, ["rev-parse", "HEAD"])).stdout.trim();
  await git(dir, ["checkout", "-q", "-b", branch]);
  return { dir, branch, baseCommit, reused: false };
}

export type FileChange = { filePath: string; changeType: "ADDED" | "MODIFIED" | "DELETED"; additions: number; deletions: number; diff: string };

/** Stage everything and commit; returns the new HEAD or null if nothing changed. */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(dir, ["add", "-A"]);
  const status = (await git(dir, ["status", "--porcelain"])).stdout.trim();
  if (!status) return null;
  await git(dir, ["commit", "-q", "-m", message]);
  return (await git(dir, ["rev-parse", "HEAD"])).stdout.trim();
}

/** Uncommitted + committed changes relative to `base`. */
export async function diffAgainst(dir: string, base: string): Promise<FileChange[]> {
  await git(dir, ["add", "-A"]);
  const numstat = (await git(dir, ["diff", "--cached", "--numstat", base])).stdout.trim();
  const nameStatus = (await git(dir, ["diff", "--cached", "--name-status", base])).stdout.trim();
  if (!numstat) return [];
  const kinds = new Map<string, string>();
  for (const line of nameStatus.split("\n")) {
    const [k, ...rest] = line.split("\t");
    kinds.set(rest[rest.length - 1], k);
  }
  const out: FileChange[] = [];
  for (const line of numstat.split("\n")) {
    const [add, del, file] = line.split("\t");
    const diff = (await git(dir, ["diff", "--cached", "--no-color", base, "--", file])).stdout;
    const k = kinds.get(file) ?? "M";
    out.push({
      filePath: file,
      changeType: k.startsWith("A") ? "ADDED" : k.startsWith("D") ? "DELETED" : "MODIFIED",
      additions: Number(add) || 0,
      deletions: Number(del) || 0,
      diff: diff.slice(0, 200_000),
    });
  }
  return out;
}

export async function resetToCommit(dir: string, commit: string) {
  await git(dir, ["reset", "-q", "--hard", commit]);
  await git(dir, ["clean", "-qfd"]);
}

export async function pushBranch(dir: string, branch: string, token: string) {
  await git(dir, ["push", "-q", "https://github.com/" + (await originPath(dir)) + ".git", `${branch}:${branch}`], { auth: { host: "github.com", token }, timeoutMs: 120_000 });
}

async function originPath(dir: string) {
  const url = (await git(dir, ["remote", "get-url", "origin"])).stdout.trim();
  const m = url.match(/github\.com[/:]([^/]+\/[^/.]+)(\.git)?$/);
  if (!m) throw new Error("Workspace origin is not a GitHub repository");
  return m[1];
}

async function exists(p: string) {
  return fs.stat(p).then(() => true).catch(() => false);
}
