import type { BadgeTone } from "@/components/ui/badge";

export const STATUS_META: Record<string, { label: string; tone: BadgeTone; active?: boolean }> = {
  NEW: { label: "New", tone: "neutral" },
  TRIAGING: { label: "Triaging", tone: "warning", active: true },
  INVESTIGATING: { label: "Investigating", tone: "info", active: true },
  FIXING: { label: "Fixing", tone: "accent", active: true },
  TESTING: { label: "Testing", tone: "accent", active: true },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  RESOLVED: { label: "Resolved", tone: "success" },
  NEEDS_INFORMATION: { label: "Needs information", tone: "warning" },
  BLOCKED: { label: "Blocked", tone: "danger" },
  FAILED: { label: "Failed", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const SEVERITY_META: Record<string, { label: string; tone: BadgeTone }> = {
  CRITICAL: { label: "Critical", tone: "danger" },
  HIGH: { label: "High", tone: "warning" },
  MEDIUM: { label: "Medium", tone: "info" },
  LOW: { label: "Low", tone: "neutral" },
};

export const AGENT_META: Record<string, { short: string; name: string; role: string; color: string; ring: string; text: string }> = {
  TRIAGE: { short: "Triage", name: "PATCHWORK_Triage", role: "Incident coordinator", color: "bg-warning-soft", ring: "border-warning/40", text: "text-warning" },
  INVESTIGATOR: { short: "Investigator", name: "PATCHWORK_Investigator", role: "Debugging engineer", color: "bg-info-soft", ring: "border-info/40", text: "text-info" },
  FIXER: { short: "Fixer", name: "PATCHWORK_Fixer", role: "Software engineer", color: "bg-accent-soft", ring: "border-accent/40", text: "text-accent" },
  QA: { short: "QA", name: "PATCHWORK_QA", role: "Quality assurance", color: "bg-success-soft", ring: "border-success/40", text: "text-success" },
};

export const ROLE_BY_AGENT_ID: Record<string, keyof typeof AGENT_META> = {
  agent_triage: "TRIAGE",
  agent_investigator: "INVESTIGATOR",
  agent_fixer: "FIXER",
  agent_qa: "QA",
};

export const AGENT_STATUS_META: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "accent" | "info"; pulse?: boolean }> = {
  IDLE: { label: "Idle", tone: "neutral" },
  WORKING: { label: "Working", tone: "accent", pulse: true },
  WAITING: { label: "Waiting", tone: "warning", pulse: true },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const VERIFICATION_META: Record<string, { label: string; tone: BadgeTone; help: string }> = {
  VERIFIED: { label: "Verified", tone: "success", help: "PATCHWORK checked this against the repository or recorded command output." },
  UNVERIFIED: { label: "Unverified", tone: "neutral", help: "An agent's claim or opinion that could not be checked." },
  CONTRADICTED: { label: "Contradicted", tone: "danger", help: "PATCHWORK checked this claim and found it to be false." },
  SUPERSEDED: { label: "Superseded", tone: "info", help: "Was true, but applies to an earlier version of the fix." },
};

export const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  CODE_REFERENCE: "Code reference",
  ERROR_LOG: "Error log",
  STACK_TRACE: "Stack trace",
  TERMINAL_OUTPUT: "Terminal output",
  TEST_RESULT: "Test result",
  REPOSITORY_METADATA: "Repository metadata",
  AGENT_OBSERVATION: "Agent observation",
  EXTERNAL_DEPENDENCY: "External dependency",
};

export const WORKFLOW_STAGES = [
  { key: "report", label: "Report", statuses: ["NEW"] },
  { key: "triage", label: "Triage", statuses: ["TRIAGING", "NEEDS_INFORMATION"] },
  { key: "investigate", label: "Investigate", statuses: ["INVESTIGATING"] },
  { key: "fix", label: "Fix", statuses: ["FIXING"] },
  { key: "qa", label: "QA", statuses: ["TESTING"] },
  { key: "approval", label: "Approval", statuses: ["AWAITING_APPROVAL", "APPROVED", "REJECTED", "RESOLVED"] },
] as const;
