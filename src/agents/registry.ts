import type { AgentRole } from "@prisma/client";
import { config } from "@/src/lib/config";
import type { AgentDefinition } from "./base/agent";
import { fixerAgent } from "./fixer";
import { investigatorAgent } from "./investigator";
import { qaAgent } from "./qa";
import { triageAgent } from "./triage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AGENTS: Record<AgentRole, AgentDefinition<any>> = {
  TRIAGE: triageAgent,
  INVESTIGATOR: investigatorAgent,
  FIXER: fixerAgent,
  QA: qaAgent,
};

export function modelFor(role: AgentRole): string {
  const c = config();
  return { TRIAGE: c.TRIAGE_MODEL, INVESTIGATOR: c.INVESTIGATOR_MODEL, FIXER: c.FIXER_MODEL, QA: c.QA_MODEL }[role];
}

export const AGENT_PROFILES: Record<AgentRole, { id: string; capabilities: string[]; description: string }> = {
  TRIAGE: {
    id: "agent_triage",
    description: "Reads incoming bug reports, classifies them, sets severity, forms a testable hypothesis and delegates the investigation. Requests human approval when QA passes.",
    capabilities: ["Issue classification", "Severity assessment", "Investigation planning", "Task delegation", "Approval requests"],
  },
  INVESTIGATOR: {
    id: "agent_investigator",
    description: "Explores the repository read-only, reproduces failures with the existing tests and reports an evidence-backed root cause.",
    capabilities: ["Repository exploration", "Code search", "Failure reproduction", "Root-cause analysis", "Evidence collection"],
  },
  FIXER: {
    id: "agent_fixer",
    description: "Implements the smallest safe change on an isolated working branch, following the codebase's conventions, and hands it to QA.",
    capabilities: ["Minimal code changes", "Isolated branches", "Convention-aware edits", "Responding to QA feedback"],
  },
  QA: {
    id: "agent_qa",
    description: "Independently reviews the diff, runs the tests, checks for regressions and returns failures to the Fixer with evidence.",
    capabilities: ["Diff review", "Test execution", "Regression analysis", "Verdicts: PASS / FAIL / NEEDS_REVIEW"],
  },
};
