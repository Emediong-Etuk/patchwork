/**
 * Read/search/write helpers confined to one workspace directory. Paths from
 * agents are untrusted: they are resolved against the root and rejected if
 * they (or their real path) escape it.
 */
import { promises as fs } from "fs";
import path from "path";

const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".venv", "__pycache__", "target", ".patchwork", ".turbo"]);
const MAX_FILE_BYTES = 512 * 1024;

export class PathRejectedError extends Error {}

export async function resolveInside(root: string, rel: string): Promise<string> {
  if (typeof rel !== "string" || !rel.trim()) throw new PathRejectedError("Path is required");
  if (path.isAbsolute(rel)) throw new PathRejectedError("Use a path relative to the repository root");
  const normalized = path.normalize(rel).replace(/^(\.\/)+/, "");
  if (normalized.split(path.sep).includes("..")) throw new PathRejectedError("Path may not contain '..'");
  if (normalized.split(path.sep)[0] === ".git") throw new PathRejectedError("The .git directory is off limits");
  const realRoot = await fs.realpath(root);
  const full = path.resolve(realRoot, normalized);
  if (full !== realRoot && !full.startsWith(realRoot + path.sep)) throw new PathRejectedError("Path escapes the repository");
  // If it exists, its real path must also stay inside (no symlink escapes).
  try {
    const real = await fs.realpath(full);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new PathRejectedError("Path resolves outside the repository");
  } catch (e) {
    if (e instanceof PathRejectedError) throw e;
  }
  return full;
}

export async function listFiles(root: string, dir = ".", maxEntries = 400): Promise<string[]> {
  const start = await resolveInside(root, dir === "" ? "." : dir);
  const realRoot = await fs.realpath(root);
  const out: string[] = [];
  async function walk(abs: string) {
    if (out.length >= maxEntries) return;
    const entries = await fs.readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= maxEntries) return;
      if (e.isSymbolicLink()) continue;
      const full = path.join(abs, e.name);
      const rel = path.relative(realRoot, full);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        out.push(rel + "/");
        await walk(full);
      } else if (e.isFile()) out.push(rel);
    }
  }
  await walk(start);
  return out;
}

export async function readFileLines(root: string, rel: string, startLine = 1, endLine?: number): Promise<{ path: string; totalLines: number; startLine: number; endLine: number; text: string }> {
  const full = await resolveInside(root, rel);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat || !stat.isFile()) throw new PathRejectedError(`File not found: ${rel}`);
  if (stat.size > MAX_FILE_BYTES) throw new PathRejectedError(`File is too large to read (${stat.size} bytes)`);
  const lines = (await fs.readFile(full, "utf8")).split("\n");
  const s = Math.max(1, startLine);
  const e = Math.min(lines.length, endLine ?? s + 299, s + 399);
  const text = lines
    .slice(s - 1, e)
    .map((l, i) => `${String(s + i).padStart(4, " ")}| ${l}`)
    .join("\n");
  return { path: path.normalize(rel), totalLines: lines.length, startLine: s, endLine: e, text };
}

export async function searchCode(root: string, query: string, opts: { regex?: boolean; maxResults?: number } = {}): Promise<{ path: string; line: number; text: string }[]> {
  if (!query || query.length > 200) throw new PathRejectedError("Query must be 1-200 characters");
  let re: RegExp;
  try {
    re = opts.regex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch {
    throw new PathRejectedError("Invalid regular expression");
  }
  const files = (await listFiles(root, ".", 5000)).filter((f) => !f.endsWith("/"));
  const results: { path: string; line: number; text: string }[] = [];
  const max = opts.maxResults ?? 60;
  for (const f of files) {
    if (results.length >= max) break;
    const full = path.join(await fs.realpath(root), f);
    const stat = await fs.stat(full);
    if (stat.size > MAX_FILE_BYTES) continue;
    const content = await fs.readFile(full, "utf8").catch(() => "");
    if (content.includes("\u0000")) continue; // binary
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && results.length < max; i++) {
      if (re.test(lines[i])) results.push({ path: f, line: i + 1, text: lines[i].slice(0, 240) });
    }
  }
  return results;
}

export async function writeFileSafe(root: string, rel: string, content: string): Promise<{ path: string; created: boolean }> {
  if (content.length > MAX_FILE_BYTES) throw new PathRejectedError("Content too large");
  const full = await resolveInside(root, rel);
  const existed = await fs.stat(full).then(() => true).catch(() => false);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  return { path: path.normalize(rel), created: !existed };
}

export async function replaceInFile(root: string, rel: string, oldText: string, newText: string): Promise<{ path: string }> {
  const full = await resolveInside(root, rel);
  const content = await fs.readFile(full, "utf8").catch(() => {
    throw new PathRejectedError(`File not found: ${rel}`);
  });
  const count = content.split(oldText).length - 1;
  if (!oldText) throw new PathRejectedError("old_text must not be empty");
  if (count === 0) throw new PathRejectedError("old_text was not found in the file; read the file again and copy the text exactly");
  if (count > 1) throw new PathRejectedError(`old_text matches ${count} places; include more surrounding lines so it is unique`);
  await fs.writeFile(full, content.replace(oldText, () => newText), "utf8");
  return { path: path.normalize(rel) };
}
