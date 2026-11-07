import path from "path";
import { db } from "@/src/lib/database/client";
import { emitEvent } from "@/src/lib/events/bus";
import { CommandRejectedError, allowedCommandsSummary } from "@/src/lib/security/commands";
import { listFiles, PathRejectedError, readFileLines, replaceInFile, searchCode, writeFileSafe } from "@/src/lib/execution/fs-tools";
import { runCommand } from "@/src/lib/execution/runner";
import { diffAgainst } from "@/src/lib/execution/workspace";
import { untrusted } from "@/src/lib/security/untrusted";
import type { ToolSpec } from "@/src/lib/ai/types";

export type ToolName = "list_files" | "read_file" | "search_code" | "run_tests" | "view_diff" | "replace_in_file" | "write_file";

export type ToolContext = {
  incidentId: string;
  workspaceId: string;
  agentId: string;
  agentName: string;
  workspaceDir: string;
  baseCommit: string;
  attempt: number;
  taskId: string;
  signal?: AbortSignal;
  /** Filled in as the agent works; used to verify claims afterwards. */
  trace: { filesRead: Set<string>; filesWritten: Set<string>; testRunIds: string[] };
};

export type ToolOutcome = { content: string; isError?: boolean; summary: string };

type ToolImpl = { spec: ToolSpec; run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome> };

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string") throw new PathRejectedError(`"${name}" must be a string`);
  return v;
};
const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined);

export const TOOLS: Record<ToolName, ToolImpl> = {
  list_files: {
    spec: {
      name: "list_files",
      description: "List files and directories (recursively) under a path in the repository. Directories end with '/'. Dependency and build folders are skipped.",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "Directory relative to the repo root; default '.'" } }, additionalProperties: false },
    },
    run: async (input, ctx) => {
      const dir = typeof input.path === "string" && input.path ? input.path : ".";
      const files = await listFiles(ctx.workspaceDir, dir, 400);
      return { content: files.length ? files.join("\n") : "(empty)", summary: `listed ${dir} (${files.length} entries)` };
    },
  },
  read_file: {
    spec: {
      name: "read_file",
      description: "Read a text file with line numbers. Reads at most 400 lines per call; use start_line/end_line for larger files.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 1 } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    run: async (input, ctx) => {
      const r = await readFileLines(ctx.workspaceDir, str(input.path, "path"), optNum(input.start_line), optNum(input.end_line));
      ctx.trace.filesRead.add(r.path);
      return { content: `${r.path} (lines ${r.startLine}-${r.endLine} of ${r.totalLines})\n${untrusted(`file:${r.path}`, r.text)}`, summary: `read ${r.path}:${r.startLine}-${r.endLine}` };
    },
  },
  search_code: {
    spec: {
      name: "search_code",
      description: "Search all repository text files for a string (case-insensitive) or a regular expression. Returns path:line: text.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, regex: { type: "boolean" } }, required: ["query"], additionalProperties: false },
    },
    run: async (input, ctx) => {
      const q = str(input.query, "query");
      const hits = await searchCode(ctx.workspaceDir, q, { regex: input.regex === true });
      return { content: hits.length ? untrusted("search-results", hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n")) : "No matches.", summary: `searched "${q.slice(0, 60)}" (${hits.length} hits)` };
    },
  },
  run_tests: {
    spec: {
      name: "run_tests",
      description: `Run an allowlisted test/check command in the repository (no shell features). Output and exit code are recorded as evidence. Allowed forms: ${allowedCommandsSummary()}`,
      inputSchema: { type: "object", properties: { command: { type: "string", description: 'e.g. "npm test" or "node --test test/register.test.js"' } }, required: ["command"], additionalProperties: false },
    },
    run: async (input, ctx) => {
      const command = str(input.command, "command");
      const startedAt = new Date();
      await emitEvent({ incidentId: ctx.incidentId, workspaceId: ctx.workspaceId, actorType: "AGENT", actorId: ctx.agentId, eventType: "TEST_STARTED", description: `${ctx.agentName} is running \`${command}\``, metadata: { command, attempt: ctx.attempt } });
      let result;
      try {
        result = await runCommand(ctx.workspaceDir, command);
      } catch (e) {
        if (e instanceof CommandRejectedError) return { content: `Command rejected by PATCHWORK policy: ${e.message}`, isError: true, summary: `command rejected: ${command}` };
        throw e;
      }
      const run = await db.testRun.create({
        data: {
          incidentId: ctx.incidentId,
          agentId: ctx.agentId,
          attempt: ctx.attempt,
          command: result.command,
          status: result.status,
          exitCode: result.exitCode,
          output: result.stdout,
          errorOutput: result.stderr,
          durationMs: result.durationMs,
          startedAt,
          completedAt: new Date(),
        },
      });
      ctx.trace.testRunIds.push(run.id);
      await db.evidence.create({
        data: {
          incidentId: ctx.incidentId,
          agentId: ctx.agentId,
          type: "TEST_RESULT",
          title: `\`${result.command}\` ${result.status === "PASSED" ? "passed" : result.status === "TIMED_OUT" ? "timed out" : "failed"} (exit ${result.exitCode ?? "n/a"})`,
          description: `Executed by ${ctx.agentName} in the incident workspace (${result.isolation} isolation, ${result.durationMs} ms). Recorded by PATCHWORK from the real process output.`,
          source: "PATCHWORK command runner",
          command: result.command,
          content: tail(`${result.stdout}\n${result.stderr}`.trim(), 6000),
          verificationStatus: "VERIFIED",
          verificationNote: "Captured directly from the executed process; not an agent claim.",
          attempt: ctx.attempt,
          taskId: ctx.taskId,
        },
      });
      await emitEvent({
        incidentId: ctx.incidentId,
        workspaceId: ctx.workspaceId,
        actorType: "AGENT",
        actorId: ctx.agentId,
        eventType: "TEST_COMPLETED",
        description: `\`${result.command}\` ${result.status.toLowerCase().replace("_", " ")} in ${result.durationMs} ms (exit ${result.exitCode ?? "n/a"})`,
        metadata: { testRunId: run.id, status: result.status, exitCode: result.exitCode, attempt: ctx.attempt },
      });
      const body = `status: ${result.status}\nexit code: ${result.exitCode}\nduration: ${result.durationMs} ms\n--- stdout ---\n${tail(result.stdout, 8000)}\n--- stderr ---\n${tail(result.stderr, 4000)}`;
      return { content: untrusted(`command-output:${result.command}`, body), summary: `ran \`${result.command}\` → ${result.status}` };
    },
  },
  view_diff: {
    spec: { name: "view_diff", description: "Show the full diff of the working branch against the default branch (what the Fixer changed).", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    run: async (_input, ctx) => {
      const changes = await diffAgainst(ctx.workspaceDir, ctx.baseCommit);
      if (!changes.length) return { content: "No changes relative to the default branch.", summary: "viewed diff (empty)" };
      return { content: untrusted("diff", changes.map((c) => c.diff).join("\n")), summary: `viewed diff (${changes.length} files)` };
    },
  },
  replace_in_file: {
    spec: {
      name: "replace_in_file",
      description: "Replace one exact, unique occurrence of old_text with new_text in a file. Copy old_text exactly from read_file output (without the line-number prefix).",
      inputSchema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"], additionalProperties: false },
    },
    run: async (input, ctx) => {
      const r = await replaceInFile(ctx.workspaceDir, str(input.path, "path"), str(input.old_text, "old_text"), str(input.new_text, "new_text"));
      ctx.trace.filesWritten.add(r.path);
      return { content: `Edited ${r.path}.`, summary: `edited ${r.path}` };
    },
  },
  write_file: {
    spec: {
      name: "write_file",
      description: "Create a new file or overwrite an existing one with the full content. Prefer replace_in_file for small edits to existing files.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
    },
    run: async (input, ctx) => {
      const rel = str(input.path, "path");
      if (/(^|[\\/])\.env(\.|$)/.test(rel) || path.basename(rel).startsWith(".env")) return { content: "Writing .env files is not allowed.", isError: true, summary: "blocked .env write" };
      const r = await writeFileSafe(ctx.workspaceDir, rel, str(input.content, "content"));
      ctx.trace.filesWritten.add(r.path);
      return { content: `${r.created ? "Created" : "Overwrote"} ${r.path}.`, summary: `${r.created ? "created" : "rewrote"} ${r.path}` };
    },
  },
};

function tail(s: string, max: number) {
  return s.length <= max ? s : `...[truncated]\n${s.slice(-max)}`;
}

export async function executeTool(name: string, allowed: ToolName[], input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!allowed.includes(name as ToolName)) return { content: `Tool "${name}" is not available to you.`, isError: true, summary: `denied tool ${name}` };
  const impl = TOOLS[name as ToolName];
  try {
    return await impl.run((input ?? {}) as Record<string, unknown>, ctx);
  } catch (e) {
    if (e instanceof PathRejectedError) return { content: e.message, isError: true, summary: `${name} rejected: ${e.message}` };
    return { content: `Tool failed: ${(e as Error).message}`, isError: true, summary: `${name} failed` };
  }
}
