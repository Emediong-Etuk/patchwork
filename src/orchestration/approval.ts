/**
 * The human approval gate. Approving records the decision and runs the
 * configured resolution action (open a pull request, or preserve the branch
 * for a local repository). It never merges: merging stays a separate,
 * explicit action on GitHub.
 */
import { db } from "@/src/lib/database/client";
import { emitEvent } from "@/src/lib/events/bus";
import { HttpError } from "@/src/lib/auth/session";
import { github } from "@/src/lib/github/client";
import { getGitHubToken, getWorkspaceGitHubToken } from "@/src/lib/github/tokens";
import { pushBranch } from "@/src/lib/execution/workspace";
import { postNotice } from "@/src/services/room-messages";
import type { FixReport, InvestigationReport, QAReport } from "@/src/schemas/agents";
import { transition } from "./state-machine";

export async function approveFix(incidentId: string, user: { id: string; name: string }, opts: { createPullRequest: boolean; note?: string }) {
  const incident = await db.incident.findUniqueOrThrow({ where: { id: incidentId }, include: { repository: true } });
  if (incident.status !== "AWAITING_APPROVAL") throw new HttpError(409, `Only incidents awaiting approval can be approved (current status ${incident.status})`, "invalid_state");
  if (!(await transition(incidentId, "AWAITING_APPROVAL", "APPROVED"))) throw new HttpError(409, "The incident changed state; reload and try again", "conflict");
  await db.approval.create({ data: { incidentId, userId: user.id, decision: "APPROVED", reason: opts.note ?? null } });
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "USER", actorId: user.id, eventType: "FIX_APPROVED", description: `${user.name} approved the fix${opts.note ? `: ${opts.note}` : ""}` });
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_STATUS_CHANGED", description: "AWAITING_APPROVAL → APPROVED", metadata: { from: "AWAITING_APPROVAL", to: "APPROVED" } });
  await postNotice({ incident, from: "RELAY", to: ["TRIAGE"], text: `${user.name} approved the fix for INC-${incident.number}.${opts.createPullRequest && incident.repository.provider === "GITHUB" ? " Opening a pull request (it will not be merged automatically)." : ""}`, messageType: "STATUS_UPDATE" });

  if (incident.repository.provider === "GITHUB" && opts.createPullRequest) return createPullRequest(incidentId, user);
  await resolve(incidentId, user, incident.repository.provider === "LOCAL" ? `Branch ${incident.workingBranch} preserved in ${incident.workspacePath}. Local repositories have no remote, so no pull request was opened.` : `Branch ${incident.workingBranch} preserved; no pull request requested.`);
  return db.incident.findUniqueOrThrow({ where: { id: incidentId } });
}

export async function rejectFix(incidentId: string, user: { id: string; name: string }, reason: string) {
  const incident = await db.incident.findUniqueOrThrow({ where: { id: incidentId }, include: { repository: true } });
  if (incident.status !== "AWAITING_APPROVAL") throw new HttpError(409, `Only incidents awaiting approval can be rejected (current status ${incident.status})`, "invalid_state");
  if (!(await transition(incidentId, "AWAITING_APPROVAL", "REJECTED"))) throw new HttpError(409, "The incident changed state; reload and try again", "conflict");
  await db.approval.create({ data: { incidentId, userId: user.id, decision: "REJECTED", reason } });
  await db.agentMessage.create({ data: { incidentId, senderType: "HUMAN", senderName: user.name, messageType: "HUMAN", content: `Rejected the fix: ${reason}`, metadata: { kind: "rejection" } } });
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "USER", actorId: user.id, eventType: "FIX_REJECTED", description: `${user.name} rejected the fix: ${reason}` });
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_STATUS_CHANGED", description: "AWAITING_APPROVAL → REJECTED", metadata: { from: "AWAITING_APPROVAL", to: "REJECTED" } });
  await postNotice({ incident, from: "RELAY", to: ["FIXER"], text: `${user.name} rejected the proposed fix: ${reason}`, messageType: "HUMAN" });
  return db.incident.findUniqueOrThrow({ where: { id: incidentId } });
}

async function resolve(incidentId: string, user: { id: string; name: string }, how: string) {
  const incident = await db.incident.findUniqueOrThrow({ where: { id: incidentId } });
  if (!(await transition(incidentId, "APPROVED", "RESOLVED", { resolvedAt: new Date(), lastError: null }))) return;
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_RESOLVED", description: `Resolved. ${how}`, metadata: { by: user.id } });
  await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "INCIDENT_STATUS_CHANGED", description: "APPROVED → RESOLVED", metadata: { from: "APPROVED", to: "RESOLVED" } });
}

export function pullRequestBody(i: { number: number; title: string; description: string; rootCause: string | null; workingBranch: string | null }, inv: InvestigationReport | null, fix: FixReport | null, qa: QAReport | null, evidence: { title: string; verificationStatus: string }[], approver: string) {
  return [
    `Fixes PATCHWORK incident **INC-${i.number}: ${i.title}**`,
    "",
    "## Original issue",
    i.description,
    "",
    "## Root cause",
    i.rootCause ?? inv?.rootCause ?? "_See investigation._",
    "",
    "## Fix",
    fix ? `${fix.summary}\n\n**Why it works:** ${fix.whyItWorks}\n\n**Potential side effects:** ${fix.potentialSideEffects.join("; ") || "none identified"}` : "_No implementation summary._",
    "",
    "## QA",
    qa ? `**Verdict: ${qa.verdict}**\n\n${qa.testSummary}\n\nCommands executed:\n${qa.commandsExecuted.map((c) => `- \`${c}\``).join("\n")}\n\nRegression analysis: ${qa.regressionAnalysis}` : "_No QA report._",
    "",
    "## Evidence summary",
    evidence.slice(0, 15).map((e) => `- [${e.verificationStatus}] ${e.title}`).join("\n") || "_None._",
    "",
    "---",
    `Prepared by PATCHWORK agents (Triage, Investigator, Fixer, QA) collaborating over Switch. Approved by ${approver}. This pull request was **not** merged automatically; merging requires a separate decision.`,
  ].join("\n");
}

export async function createPullRequest(incidentId: string, user: { id: string; name: string }) {
  const incident = await db.incident.findUniqueOrThrow({ where: { id: incidentId }, include: { repository: true } });
  if (incident.status !== "APPROVED") throw new HttpError(409, "A pull request can only be opened for an approved fix", "invalid_state");
  if (incident.repository.provider !== "GITHUB") throw new HttpError(400, "This repository is local; there is no GitHub remote to open a pull request against", "not_github");
  if (incident.pullRequestUrl) return incident;
  const token = (await getGitHubToken(user.id))?.token ?? (await getWorkspaceGitHubToken(incident.workspaceId));
  if (!token) throw new HttpError(400, "Connect GitHub to open pull requests", "github_not_connected");
  const latest = async <T>(stage: string) => ((await db.agentTask.findFirst({ where: { incidentId, stage, status: "COMPLETED" }, orderBy: { completedAt: "desc" } }))?.result as { report?: T } | null)?.report ?? null;
  try {
    await pushBranch(incident.workspacePath!, incident.workingBranch!, token);
    const evidence = await db.evidence.findMany({ where: { incidentId, verificationStatus: { in: ["VERIFIED", "CONTRADICTED"] } }, orderBy: { createdAt: "asc" } });
    const pr = await github.createPull(token, incident.repository.fullName, {
      title: `fix: ${incident.title} (PATCHWORK INC-${incident.number})`,
      head: incident.workingBranch!,
      base: incident.repository.defaultBranch,
      body: pullRequestBody(incident, await latest<InvestigationReport>("investigation"), await latest<FixReport>("fix"), await latest<QAReport>("qa"), evidence, user.name),
    });
    await db.incident.update({ where: { id: incidentId }, data: { pullRequestUrl: pr.html_url, pullRequestNumber: pr.number } });
    await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "PULL_REQUEST_CREATED", description: `Opened pull request #${pr.number} (not merged)`, metadata: { url: pr.html_url, number: pr.number } });
    await postNotice({ incident, from: "RELAY", to: [], text: `Pull request opened: ${pr.html_url} (not merged).`, messageType: "STATUS_UPDATE" });
    await resolve(incidentId, user, `Pull request #${pr.number} opened for review.`);
  } catch (e) {
    await db.incident.update({ where: { id: incidentId }, data: { lastError: `Pull request creation failed: ${(e as Error).message}` } });
    await emitEvent({ incidentId, workspaceId: incident.workspaceId, actorType: "SYSTEM", eventType: "WORKFLOW_ERROR", description: `Pull request creation failed: ${(e as Error).message}. The fix stays approved; retry from the incident page.` });
    throw new HttpError(502, `Pull request creation failed: ${(e as Error).message}`, "github_error");
  }
  return db.incident.findUniqueOrThrow({ where: { id: incidentId } });
}
