/**
 * Turns agent-supplied evidence into Evidence records, checking each claim
 * against ground truth PATCHWORK holds itself:
 *  - code references are re-read from the workspace,
 *  - test/terminal claims must match a command that was actually executed,
 *  - stack traces / error logs must appear in the report or recorded output.
 * Opinions are stored as UNVERIFIED observations, never as facts.
 */
import type { EvidenceType, VerificationStatus } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { readFileLines } from "@/src/lib/execution/fs-tools";
import { redact } from "@/src/lib/security/redact";
import type { EvidenceItem } from "@/src/schemas/agents";

const norm = (s: string) => s.replace(/^\s*\d+\|\s?/gm, "").replace(/\s+/g, " ").trim().toLowerCase();

export type VerifyContext = {
  incidentId: string;
  agentId: string;
  workspaceDir: string | null;
  testRunIds: string[];
  reportText: string; // error message + stack trace from the incident
  attempt: number;
  taskId: string;
};

export async function verifyEvidenceItem(item: EvidenceItem, ctx: VerifyContext): Promise<{ status: VerificationStatus; note: string }> {
  switch (item.type) {
    case "CODE_REFERENCE": {
      if (!item.filePath) return { status: "UNVERIFIED", note: "No file path given, so the reference could not be checked." };
      if (!ctx.workspaceDir) return { status: "UNVERIFIED", note: "Workspace unavailable for verification." };
      try {
        const start = item.lineStart ?? 1;
        const end = Math.max(item.lineEnd ?? start, start);
        const window = await readFileLines(ctx.workspaceDir, item.filePath, Math.max(1, start - 3), end + 3);
        if (start > window.totalLines) return { status: "CONTRADICTED", note: `${item.filePath} has only ${window.totalLines} lines; the cited line ${start} does not exist.` };
        if (!item.excerpt) return { status: "UNVERIFIED", note: `Location ${item.filePath}:${start}-${end} exists, but no excerpt was given to check the claim against.` };
        const lines = item.excerpt.split("\n").map(norm).filter((l) => l.length > 2);
        const haystack = norm(window.text);
        const found = lines.filter((l) => haystack.includes(l)).length;
        if (lines.length && found === lines.length) return { status: "VERIFIED", note: `Excerpt matches ${item.filePath}:${start}-${end} in the repository.` };
        if (found > 0) return { status: "UNVERIFIED", note: `Only ${found} of ${lines.length} excerpt lines were found near ${item.filePath}:${start}-${end}.` };
        return { status: "CONTRADICTED", note: `The excerpt does not appear at ${item.filePath}:${start}-${end}.` };
      } catch (e) {
        return { status: "CONTRADICTED", note: `Could not read ${item.filePath}: ${(e as Error).message}` };
      }
    }
    case "TEST_RESULT":
    case "TERMINAL_OUTPUT": {
      const runs = ctx.testRunIds.length ? await db.testRun.findMany({ where: { id: { in: ctx.testRunIds } } }) : [];
      if (!runs.length) return { status: "CONTRADICTED", note: "No command was executed in this task, so this result cannot be real." };
      const cmd = item.command?.trim();
      const candidates = cmd ? runs.filter((r) => r.command === cmd) : runs;
      if (cmd && !candidates.length) return { status: "CONTRADICTED", note: `\`${cmd}\` was never executed in this task.` };
      if (!item.excerpt) return { status: "VERIFIED", note: `Matches executed command \`${candidates[0].command}\` (${candidates[0].status}).` };
      const ex = norm(item.excerpt).slice(0, 300);
      const hit = candidates.find((r) => norm(`${r.output}\n${r.errorOutput}`).includes(ex));
      return hit ? { status: "VERIFIED", note: `Excerpt found in the recorded output of \`${hit.command}\`.` } : { status: "UNVERIFIED", note: "The command ran, but this excerpt is not in its recorded output." };
    }
    case "STACK_TRACE":
    case "ERROR_LOG": {
      if (!item.excerpt) return { status: "UNVERIFIED", note: "No excerpt to check." };
      const ex = norm(item.excerpt).slice(0, 200);
      if (norm(ctx.reportText).includes(ex)) return { status: "VERIFIED", note: "Excerpt appears in the incident report's error message or stack trace." };
      const runs = ctx.testRunIds.length ? await db.testRun.findMany({ where: { id: { in: ctx.testRunIds } } }) : [];
      if (runs.some((r) => norm(`${r.output}\n${r.errorOutput}`).includes(ex))) return { status: "VERIFIED", note: "Excerpt appears in recorded command output." };
      return { status: "UNVERIFIED", note: "Excerpt not found in the report or in any recorded output." };
    }
    default:
      return { status: "UNVERIFIED", note: "Agent observation; recorded as an opinion, not a verified fact." };
  }
}

export async function recordAgentEvidence(items: EvidenceItem[], ctx: VerifyContext, influence: string, source: string) {
  const out = [];
  for (const item of items) {
    const v = await verifyEvidenceItem(item, ctx);
    out.push(
      await db.evidence.create({
        data: {
          incidentId: ctx.incidentId,
          agentId: ctx.agentId,
          type: item.type as EvidenceType,
          title: item.title,
          description: item.description,
          source,
          filePath: item.filePath ?? null,
          lineStart: item.lineStart ?? null,
          lineEnd: item.lineEnd ?? null,
          command: item.command ?? null,
          content: item.excerpt ? redact(item.excerpt) : null,
          verificationStatus: v.status,
          verificationNote: v.note,
          influence,
          attempt: ctx.attempt,
          taskId: ctx.taskId,
        },
      }),
    );
  }
  return out;
}

export async function recordObservation(input: { incidentId: string; agentId: string | null; title: string; description: string; source: string; influence?: string; attempt?: number; taskId?: string; type?: EvidenceType; status?: VerificationStatus; note?: string; content?: string; filePath?: string }) {
  return db.evidence.create({
    data: {
      incidentId: input.incidentId,
      agentId: input.agentId,
      type: input.type ?? "AGENT_OBSERVATION",
      title: input.title,
      description: input.description,
      source: input.source,
      filePath: input.filePath ?? null,
      content: input.content ? redact(input.content) : null,
      verificationStatus: input.status ?? "UNVERIFIED",
      verificationNote: input.note ?? "Agent observation; recorded as an opinion, not a verified fact.",
      influence: input.influence ?? null,
      attempt: input.attempt ?? 1,
      taskId: input.taskId ?? null,
    },
  });
}

/** Older test evidence stops being current once a newer attempt is tested. */
export async function supersedeEarlierTestEvidence(incidentId: string, beforeAttempt: number, agentIds: string[]) {
  await db.evidence.updateMany({
    where: { incidentId, type: "TEST_RESULT", attempt: { lt: beforeAttempt }, verificationStatus: "VERIFIED", agentId: { in: agentIds } },
    data: { verificationStatus: "SUPERSEDED", verificationNote: `Superseded by fix attempt ${beforeAttempt}; this result applied to an earlier version of the patch.` },
  });
}
