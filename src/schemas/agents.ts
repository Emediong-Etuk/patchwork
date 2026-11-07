/**
 * Structured outputs for the four agents. Each agent must finish by calling
 * `submit_report` with an object matching its schema; PATCHWORK validates it
 * and asks the agent to correct invalid reports.
 */
import { z } from "zod";

export const severitySchema = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const evidenceTypeSchema = z.enum(["CODE_REFERENCE", "ERROR_LOG", "STACK_TRACE", "TERMINAL_OUTPUT", "TEST_RESULT", "REPOSITORY_METADATA", "AGENT_OBSERVATION", "EXTERNAL_DEPENDENCY"]);

export const evidenceItemSchema = z.object({
  type: evidenceTypeSchema,
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(2000).describe("What this evidence shows and why it matters"),
  filePath: z.string().max(500).optional(),
  lineStart: z.number().int().min(1).optional(),
  lineEnd: z.number().int().min(1).optional(),
  excerpt: z.string().max(4000).optional().describe("Exact text copied from the file or output"),
  command: z.string().max(300).optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const triageReportSchema = z.object({
  title: z.string().min(5).max(160).describe("Concise incident title"),
  description: z.string().min(10).max(3000).describe("Restated problem in engineering terms"),
  severity: severitySchema,
  severityRationale: z.string().min(5).max(1000),
  classification: z.string().min(3).max(100).describe('e.g. "server error", "data integrity", "UI defect"'),
  affectedFunctionality: z.array(z.string().max(200)).min(1).max(10),
  suspectedComponents: z.array(z.string().max(300)).max(10).describe("Paths or modules that may be involved (hypotheses, not verified)"),
  initialHypothesis: z.string().min(5).max(1500).describe("An assumption to test, clearly not a verified finding"),
  investigationPlan: z.array(z.string().max(400)).min(1).max(10),
  delegatedTasks: z.array(z.object({ agent: z.enum(["INVESTIGATOR", "FIXER", "QA"]), task: z.string().max(500) })).min(1).max(6),
  missingInformation: z.array(z.string().max(400)).max(10),
  needsMoreInformation: z.boolean().describe("True only if the report is too vague to investigate at all"),
});
export type TriageReport = z.infer<typeof triageReportSchema>;

export const investigationReportSchema = z.object({
  summary: z.string().min(10).max(3000),
  reproduction: z.object({
    attempted: z.boolean(),
    command: z.string().max(300).optional(),
    reproduced: z.boolean().describe("True only if a command you ran actually showed the failure"),
    details: z.string().max(3000),
  }),
  reproductionSteps: z.array(z.string().max(400)).max(10),
  relevantFiles: z.array(z.object({ path: z.string().max(500), reason: z.string().max(500) })).min(1).max(20),
  codeLocations: z.array(z.object({ path: z.string().max(500), lineStart: z.number().int().min(1), lineEnd: z.number().int().min(1), description: z.string().max(800) })).max(20),
  observedBehavior: z.string().min(3).max(2000),
  expectedBehavior: z.string().min(3).max(2000),
  rootCause: z.string().min(10).max(3000),
  evidence: z.array(evidenceItemSchema).min(1).max(20),
  confidence: z.enum(["high", "medium", "low"]),
  hypotheses: z.array(z.string().max(800)).max(10).describe("Anything you believe but did not verify"),
  recommendedFix: z.string().min(10).max(3000),
});
export type InvestigationReport = z.infer<typeof investigationReportSchema>;

export const fixReportSchema = z.object({
  rootCauseAddressed: z.string().min(10).max(2000),
  filesModified: z.array(z.object({ path: z.string().max(500), description: z.string().max(1000) })).min(1).max(20),
  summary: z.string().min(10).max(3000).describe("Description of the modifications"),
  whyItWorks: z.string().min(10).max(3000),
  potentialSideEffects: z.array(z.string().max(800)).max(10),
  testsToRun: z.array(z.string().max(300)).min(1).max(10).describe("Commands QA should execute"),
  respondedToFeedback: z.string().max(2000).optional().describe("On a retry: how you addressed QA's failure report"),
});
export type FixReport = z.infer<typeof fixReportSchema>;

export const qaReportSchema = z.object({
  verdict: z.enum(["PASS", "FAIL", "NEEDS_REVIEW"]),
  testSummary: z.string().min(5).max(3000),
  commandsExecuted: z.array(z.string().max(300)).max(20),
  testsPassed: z.number().int().min(0).optional(),
  testsFailed: z.number().int().min(0).optional(),
  relevantOutput: z.string().max(6000).describe("Exact excerpt of test output that supports the verdict"),
  regressionAnalysis: z.string().min(5).max(3000),
  implementationReview: z.string().min(5).max(3000).describe("Your own reading of the diff, independent of the Fixer's explanation"),
  outstandingConcerns: z.array(z.string().max(800)).max(10),
  failureDetailsForFixer: z.string().max(4000).optional().describe("Required for FAIL: specific evidence the Fixer needs"),
  recommendation: z.string().min(5).max(1500),
});
export type QAReport = z.infer<typeof qaReportSchema>;

export const consultReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  instructionAcknowledged: z.boolean().describe("True if the developer gave an instruction that you will follow"),
});
export type ConsultReply = z.infer<typeof consultReplySchema>;
