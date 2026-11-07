/**
 * Command policy for repository execution. Agents never get a shell: a command
 * is parsed into argv (no globbing, pipes, redirection or substitution) and
 * must match an allowlisted program + subcommand shape.
 */

export class CommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandRejectedError";
  }
}

const SHELL_META = /[;&|`$<>(){}\\\n\r*?!~#]/;
const SAFE_ARG = /^[A-Za-z0-9@+=:,./_-]+$/;

type Rule = { program: string; allow: (args: string[]) => boolean; description: string };

const isTestScript = (s: string | undefined) => !!s && /^(test|test:[a-z0-9:_-]+|lint|typecheck|check|build)$/.test(s);
const safePaths = (args: string[]) => args.every((a) => !a.startsWith("/") && !a.split("/").includes(".."));

const RULES: Rule[] = [
  {
    program: "npm",
    description: "npm test | npm run <test|test:*|lint|typecheck|check|build> | npm ci --ignore-scripts",
    allow: (a) =>
      (a[0] === "test" && safePaths(a.slice(1))) ||
      (a[0] === "run" && isTestScript(a[1]) && safePaths(a.slice(2))) ||
      (a[0] === "ci" && a.slice(1).every((x) => x === "--ignore-scripts" || x === "--no-audit" || x === "--no-fund")),
  },
  { program: "pnpm", description: "pnpm test | pnpm run <script>", allow: (a) => a[0] === "test" || (a[0] === "run" && isTestScript(a[1])) },
  { program: "yarn", description: "yarn test | yarn run <script>", allow: (a) => a[0] === "test" || (a[0] === "run" && isTestScript(a[1])) },
  {
    program: "node",
    description: "node --test [paths]",
    allow: (a) => a[0] === "--test" && a.slice(1).every((x) => x.startsWith("--test-") || !x.startsWith("-")) && safePaths(a.slice(1)),
  },
  { program: "npx", description: "npx vitest run | npx jest | npx tsc --noEmit", allow: (a) => (a[0] === "vitest" && a[1] === "run") || a[0] === "jest" || (a[0] === "tsc" && a.includes("--noEmit")) },
  { program: "pytest", description: "pytest [paths]", allow: (a) => safePaths(a) },
  { program: "python", description: "python -m pytest|unittest", allow: (a) => a[0] === "-m" && (a[1] === "pytest" || a[1] === "unittest") && safePaths(a.slice(2)) },
  { program: "go", description: "go test ./...", allow: (a) => a[0] === "test" || a[0] === "vet" },
  { program: "cargo", description: "cargo test", allow: (a) => a[0] === "test" || a[0] === "check" },
];

export type ParsedCommand = { program: string; args: string[]; display: string };

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed) throw new CommandRejectedError("Empty command");
  if (trimmed.length > 300) throw new CommandRejectedError("Command is too long");
  if (SHELL_META.test(trimmed)) throw new CommandRejectedError("Shell operators are not allowed (no pipes, redirects, substitutions or globs)");
  const parts = trimmed.split(/\s+/);
  for (const p of parts) if (!SAFE_ARG.test(p)) throw new CommandRejectedError(`Argument "${p}" contains disallowed characters`);
  const [program, ...args] = parts;
  const rule = RULES.find((r) => r.program === program);
  if (!rule) throw new CommandRejectedError(`"${program}" is not an allowed program. Allowed: ${allowedCommandsSummary()}`);
  if (!rule.allow(args)) throw new CommandRejectedError(`"${trimmed}" is not an allowed form. Allowed for ${program}: ${rule.description}`);
  return { program, args, display: trimmed };
}

export function allowedCommandsSummary(): string {
  return RULES.map((r) => r.description).join("; ");
}
