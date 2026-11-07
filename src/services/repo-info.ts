import { promises as fs } from "fs";
import path from "path";
import { parseCommand } from "@/src/lib/security/commands";

/** Best guess at the project's test command, always within the allowlist. */
export async function detectTestCommand(dir: string, override?: string | null): Promise<string | null> {
  if (override) {
    try {
      return parseCommand(override).display;
    } catch {
      /* fall through to detection */
    }
  }
  const exists = (f: string) => fs.stat(path.join(dir, f)).then(() => true).catch(() => false);
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const t = pkg.scripts?.test;
    if (t && !/no test specified/.test(t)) return "npm test";
  } catch {
    /* not a node project */
  }
  if ((await exists("pytest.ini")) || (await exists("pyproject.toml")) || (await exists("setup.cfg"))) return "pytest";
  if (await exists("go.mod")) return "go test ./...";
  if (await exists("Cargo.toml")) return "cargo test";
  return null;
}
