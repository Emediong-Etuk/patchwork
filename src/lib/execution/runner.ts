/**
 * Runs an allowlisted command inside an incident workspace. No shell, scrubbed
 * environment (no credentials), hard timeout that kills the whole process
 * group, and capped output. EXECUTION_MODE=docker adds container isolation
 * (no network, memory/CPU/PID limits).
 */
import { spawn, type ChildProcess } from "child_process";
import { mkdirSync } from "fs";
import { config } from "@/src/lib/config";
import { parseCommand } from "@/src/lib/security/commands";
import { redact } from "@/src/lib/security/redact";

export type CommandResult = {
  command: string;
  status: "PASSED" | "FAILED" | "TIMED_OUT" | "ERROR";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  isolation: "process" | "docker";
};

function cap(s: string, max: number) {
  return s.length <= max ? s : `${s.slice(0, max / 2)}\n... [${s.length - max} bytes truncated] ...\n${s.slice(-max / 2)}`;
}

export async function runCommand(cwd: string, commandLine: string, opts: { timeoutMs?: number } = {}): Promise<CommandResult> {
  const c = config();
  const parsed = parseCommand(commandLine); // throws CommandRejectedError
  const timeoutMs = Math.min(opts.timeoutMs ?? c.EXECUTION_TIMEOUT_MS, c.EXECUTION_TIMEOUT_MS);
  const maxBytes = c.EXECUTION_MAX_OUTPUT_BYTES;
  const isolation = c.EXECUTION_MODE;

  // HOME and tool caches live next to the checkout, never inside it, so
  // tooling side files (npm logs, caches) cannot end up in the fix commit.
  const home = `${cwd.replace(/\/+$/, "")}.home`;
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    npm_config_cache: `${home}/.npm`,
    npm_config_update_notifier: "false",
    XDG_CACHE_HOME: `${home}/.cache`,
    LANG: "C.UTF-8",
    CI: "true",
    NODE_ENV: "test",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };

  let program = parsed.program;
  let args = parsed.args;
  if (isolation === "docker") {
    program = "docker";
    args = ["run", "--rm", "--network", "none", "--memory", "1g", "--cpus", "1", "--pids-limit", "256", "--read-only", "--tmpfs", "/tmp", "-e", "CI=true", "-e", "NODE_ENV=test", "-e", "HOME=/tmp", "-v", `${cwd}:/work`, "-w", "/work", c.EXECUTION_DOCKER_IMAGE, parsed.program, ...parsed.args];
  }

  const started = Date.now();
  return new Promise<CommandResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ChildProcess;
    try {
      child = spawn(program, args, { cwd, env: env as NodeJS.ProcessEnv, shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ command: parsed.display, status: "ERROR", exitCode: null, stdout: "", stderr: (e as Error).message, durationMs: 0, isolation });
      return;
    }
    const killTree = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      if (stdout.length < maxBytes * 2) stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      if (stderr.length < maxBytes * 2) stderr += d.toString("utf8");
    });
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      resolve({ command: parsed.display, status: "ERROR", exitCode: null, stdout: redact(cap(stdout, maxBytes)), stderr: redact(`${stderr}\n${e.message}`), durationMs: Date.now() - started, isolation });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const status: CommandResult["status"] = timedOut ? "TIMED_OUT" : code === 0 ? "PASSED" : "FAILED";
      resolve({
        command: parsed.display,
        status,
        exitCode: code,
        stdout: redact(cap(stdout, maxBytes)),
        stderr: redact(cap(timedOut ? `${stderr}\n[PATCHWORK] Command exceeded ${timeoutMs}ms and was terminated.` : stderr, maxBytes)),
        durationMs: Date.now() - started,
        isolation,
      });
    });
  });
}
