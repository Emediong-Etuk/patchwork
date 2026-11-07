import type { StreamEvent } from "@/src/lib/events/types";

export type EvidenceRow = { id: string; agentId: string | null; type: string; title: string; description: string; source: string; filePath: string | null; lineStart: number | null; lineEnd: number | null; command: string | null; content: string | null; verificationStatus: string; verificationNote: string | null; influence: string | null; attempt: number; createdAt: string };
export type MessageRow = { id: string; agentId: string | null; senderType: "AGENT" | "HUMAN" | "SYSTEM"; senderName: string; messageType: string; content: string; metadata: { to?: string[]; mentions?: string[]; handoff?: { kind: string; taskKey: string; attempt: number } | null; switch?: { mode: string; roomId: string; messageId: string | null; delivered: boolean; deliveryAttempts: number }; relayedFor?: { name: string } | null; source?: string }; switchMessageId: string | null; createdAt: string };
export type ChangeRow = { id: string; attempt: number; filePath: string; changeType: string; additions: number; deletions: number; diff: string; commitSha: string | null; createdAt: string };
export type TestRunRow = { id: string; agentId: string | null; attempt: number; command: string; status: string; exitCode: number | null; output: string; errorOutput: string; durationMs: number | null; startedAt: string; completedAt: string | null };
export type AgentCard = { id: string; name: string; role: string; title: string; model: string; status: string; currentTask: string | null; lastActivity: string | null; tasksCompleted: number };
export type TaskRow = { id: string; agentId: string; stage: string; attempt: number; title: string; status: string; error: string | null; startedAt: string | null; completedAt: string | null };

type ReportEnvelope<T> = { taskId: string; attempt: number; completedAt: string; report: T; model?: string; steps?: number; toolCalls?: { name: string; summary: string; isError: boolean }[] } | null;

export type TriageReport = { title: string; description: string; severity: string; severityRationale: string; classification: string; affectedFunctionality: string[]; suspectedComponents: string[]; initialHypothesis: string; investigationPlan: string[]; delegatedTasks: { agent: string; task: string }[]; missingInformation: string[]; needsMoreInformation: boolean };
export type InvestigationReport = { summary: string; reproduction: { attempted: boolean; command?: string; reproduced: boolean; details: string }; reproductionSteps: string[]; relevantFiles: { path: string; reason: string }[]; codeLocations: { path: string; lineStart: number; lineEnd: number; description: string }[]; observedBehavior: string; expectedBehavior: string; rootCause: string; confidence: string; hypotheses: string[]; recommendedFix: string };
export type FixReport = { rootCauseAddressed: string; filesModified: { path: string; description: string }[]; summary: string; whyItWorks: string; potentialSideEffects: string[]; testsToRun: string[]; respondedToFeedback?: string };
export type QAReport = { verdict: "PASS" | "FAIL" | "NEEDS_REVIEW"; testSummary: string; commandsExecuted: string[]; testsPassed?: number; testsFailed?: number; relevantOutput: string; regressionAnalysis: string; implementationReview: string; outstandingConcerns: string[]; failureDetailsForFixer?: string; recommendation: string };

export type IncidentDetail = {
  incident: {
    id: string; number: number; title: string; description: string; severity: string | null; status: string; errorMessage: string | null; stackTrace: string | null; reproductionSteps: string | null; affectedArea: string | null; rootCause: string | null;
    switchRoomId: string | null; switchRoomName: string | null; switchMode: string | null; workingBranch: string | null; workspacePath: string | null; baseCommit: string | null; headCommit: string | null; fixAttempts: number; maxFixAttempts: number; pullRequestUrl: string | null; pullRequestNumber: number | null; lastError: string | null; createdAt: string; updatedAt: string; resolvedAt: string | null;
    repository: { id: string; fullName: string; provider: string; defaultBranch: string; htmlUrl: string | null; visibility: string };
  };
  agents: AgentCard[];
  messages: MessageRow[];
  evidence: EvidenceRow[];
  changes: ChangeRow[];
  testRuns: TestRunRow[];
  tasks: TaskRow[];
  reports: { triage: ReportEnvelope<TriageReport>; investigation: ReportEnvelope<InvestigationReport>; fix: ReportEnvelope<FixReport>; qa: (ReportEnvelope<QAReport> & { verdict?: string; override?: string | null }) | null; qaHistory: { attempt: number; report: QAReport; verdict: string; override: string | null }[] };
  approvals: { id: string; decision: string; reason: string | null; createdAt: string; user: { name: string; email: string } }[];
  events: StreamEvent[];
};
