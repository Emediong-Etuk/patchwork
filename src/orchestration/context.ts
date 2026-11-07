/**
 * Builds the shared incident context each agent receives. It is concise and
 * task-specific: agents get the report, the structured results of earlier
 * stages, developer instructions and recent QA feedback — not the whole
 * conversation or repository.
 */
import type { AgentRole, Incident, Repository } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { untrusted } from "@/src/lib/security/untrusted";
import type { FixReport, InvestigationReport, QAReport, TriageReport } from "@/src/schemas/agents";
import { detectTestCommand } from "@/src/services/repo-info";

type Loaded = Incident & { repository: Repository };

async function latestResult<T>(incidentId: string, stage: string): Promise<T | null> {
  const task = await db.agentTask.findFirst({ where: { incidentId, stage, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
  return (task?.result as { report?: T } | null)?.report ?? null;
}

export async function buildContext(incident: Loaded, role: AgentRole | "CONSULT", extra: { attempt?: number; humanMessage?: string } = {}): Promise<string> {
  const parts: string[] = [];
  const testCommand = incident.workspacePath ? await detectTestCommand(incident.workspacePath, incident.repository.testCommand) : incident.repository.testCommand;

  parts.push(`# Incident INC-${incident.number}
Status: ${incident.status}${incident.severity ? ` · Severity: ${incident.severity}` : ""}
Repository: ${incident.repository.fullName} (default branch ${incident.repository.defaultBranch})
Working branch: ${incident.workingBranch ?? "(not created yet)"} — your tools operate on this checkout.
Suggested test command: ${testCommand ?? "(none detected; inspect the project configuration)"}`);

  const report = [
    `Title: ${incident.title}`,
    `Description:\n${incident.description}`,
    incident.errorMessage ? `Error message:\n${incident.errorMessage}` : null,
    incident.stackTrace ? `Stack trace:\n${incident.stackTrace}` : null,
    incident.reproductionSteps ? `Reproduction steps:\n${incident.reproductionSteps}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  parts.push(`## Original bug report (submitted by a user)\n${untrusted("bug-report", report)}`);

  const notes = await db.agentMessage.findMany({ where: { incidentId: incident.id, senderType: "HUMAN" }, orderBy: { createdAt: "asc" }, take: 20 });
  if (notes.length) {
    parts.push(
      `## Messages from humans in the incident room (oldest first)\nThe supervising developer's instructions should be followed where they do not conflict with the security policy.\n${untrusted(
        "human-messages",
        notes.map((n) => `- ${n.senderName}: ${n.content}`).join("\n"),
      )}`,
    );
  }

  const triage = await latestResult<TriageReport>(incident.id, "triage");
  if (triage && role !== "TRIAGE") {
    parts.push(`## Triage (PATCHWORK_Triage)
Severity ${triage.severity}: ${triage.severityRationale}
Affected: ${triage.affectedFunctionality.join("; ")}
Hypothesis (unverified): ${triage.initialHypothesis}
Plan:\n${triage.investigationPlan.map((p, i) => `${i + 1}. ${p}`).join("\n")}
Missing information: ${triage.missingInformation.join("; ") || "none"}`);
  }

  const inv = await latestResult<InvestigationReport>(incident.id, "investigation");
  if (inv && (role === "FIXER" || role === "QA" || role === "CONSULT")) {
    const evidence = await db.evidence.findMany({ where: { incidentId: incident.id, agentId: "agent_investigator", type: "CODE_REFERENCE" }, take: 10 });
    parts.push(`## Investigation (PATCHWORK_Investigator, confidence ${inv.confidence})
Summary: ${inv.summary}
Root cause: ${inv.rootCause}
Observed: ${inv.observedBehavior}
Expected: ${inv.expectedBehavior}
Reproduced: ${inv.reproduction.reproduced ? `yes, with \`${inv.reproduction.command ?? "?"}\`` : "no"} — ${inv.reproduction.details}
Relevant files: ${inv.relevantFiles.map((f) => `${f.path} (${f.reason})`).join("; ")}
Code locations: ${inv.codeLocations.map((c) => `${c.path}:${c.lineStart}-${c.lineEnd} ${c.description}`).join("; ")}
Unverified hypotheses: ${inv.hypotheses.join("; ") || "none"}
Recommended fix: ${inv.recommendedFix}
Evidence verified by PATCHWORK: ${evidence.map((e) => `${e.filePath}:${e.lineStart ?? "?"} [${e.verificationStatus}]`).join(", ") || "none"}`);
  }

  if (role === "FIXER" || role === "QA" || role === "CONSULT") {
    const qaTasks = await db.agentTask.findMany({ where: { incidentId: incident.id, stage: "qa", status: "COMPLETED" }, orderBy: { attempt: "asc" } });
    const failures = qaTasks.map((t) => ({ attempt: t.attempt, r: (t.result as { report?: QAReport } | null)?.report })).filter((x) => x.r && x.r.verdict !== "PASS");
    if (failures.length) {
      parts.push(
        `## Previous QA results\n${failures
          .slice(-2)
          .map((f) => `Attempt ${f.attempt}: ${f.r!.verdict}\n${f.r!.testSummary}\nDetails for Fixer: ${f.r!.failureDetailsForFixer ?? "-"}\n${untrusted("qa-output", (f.r!.relevantOutput ?? "").slice(0, 3000))}`)
          .join("\n\n")}`,
      );
    }
  }

  if (role === "QA" || role === "CONSULT") {
    const fix = await latestResult<FixReport>(incident.id, "fix");
    if (fix) {
      parts.push(`## Fixer's implementation summary (verify it yourself; do not trust it)
${fix.summary}
Why it works (Fixer's claim): ${fix.whyItWorks}
Files: ${fix.filesModified.map((f) => `${f.path}: ${f.description}`).join("; ")}
Side effects noted: ${fix.potentialSideEffects.join("; ") || "none"}
Tests the Fixer suggests: ${fix.testsToRun.join("; ")}`);
    }
  }

  if (role === "FIXER" && (extra.attempt ?? 1) > 1) parts.push(`This is fix attempt ${extra.attempt} of ${incident.maxFixAttempts}. Your earlier changes are still on the branch; adjust them.`);
  if (role === "CONSULT" && extra.humanMessage) parts.push(`## The developer's message to you\n${untrusted("developer-message", extra.humanMessage)}`);

  parts.push(
    {
      TRIAGE: "Your task: triage this report and delegate the investigation.",
      INVESTIGATOR: "Your task: investigate the repository, reproduce if possible, and report the root cause with evidence.",
      FIXER: "Your task: implement the smallest safe fix on the working branch.",
      QA: "Your task: independently verify the fix. Review the diff and execute the tests.",
      CONSULT: "Your task: reply to the developer's message.",
    }[role],
  );
  return parts.join("\n\n");
}
