import { describe, expect, it } from "vitest";
import { TRANSITIONS, canTransition, assertTransition, InvalidTransitionError } from "@/src/orchestration/state-machine";
import { enforceVerdict } from "@/src/orchestration/workflow";
import { createIncidentSchema, rejectSchema, approveSchema } from "@/src/schemas/incident";
import { investigationReportSchema, qaReportSchema, triageReportSchema } from "@/src/schemas/agents";
import { demoBrains } from "../helpers/scripted-provider";

const qa = (verdict: "PASS" | "FAIL" | "NEEDS_REVIEW") => ({ verdict, testSummary: "summary", commandsExecuted: [], relevantOutput: "", regressionAnalysis: "none found", implementationReview: "reviewed", outstandingConcerns: [], recommendation: "approve" });
const run = (command: string, status: string, t: number) => ({ command, status, startedAt: new Date(t) });

describe("workflow state machine", () => {
  it("follows the main path", () => {
    const path = ["NEW", "TRIAGING", "INVESTIGATING", "FIXING", "TESTING", "AWAITING_APPROVAL", "APPROVED", "RESOLVED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("loops QA failures back to FIXING but never skips approval", () => {
    expect(canTransition("TESTING", "FIXING")).toBe(true);
    expect(canTransition("TESTING", "RESOLVED")).toBe(false);
    expect(canTransition("TESTING", "APPROVED")).toBe(false);
    expect(canTransition("FIXING", "AWAITING_APPROVAL")).toBe(false);
    expect(() => assertTransition("AWAITING_APPROVAL", "RESOLVED")).toThrow(InvalidTransitionError);
  });
  it("treats RESOLVED and CANCELLED as terminal and lets every active state be cancelled", () => {
    expect(TRANSITIONS.RESOLVED).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
    for (const s of ["TRIAGING", "INVESTIGATING", "FIXING", "TESTING", "AWAITING_APPROVAL", "BLOCKED", "FAILED"] as const) expect(canTransition(s, "CANCELLED")).toBe(true);
  });
});

describe("QA verdict enforcement", () => {
  it("accepts PASS only with executed, passing tests", () => {
    expect(enforceVerdict(qa("PASS"), [run("npm test", "PASSED", 1)])).toEqual({ verdict: "PASS", override: null });
  });
  it("downgrades PASS without any executed test to NEEDS_REVIEW", () => {
    expect(enforceVerdict(qa("PASS"), []).verdict).toBe("NEEDS_REVIEW");
  });
  it("downgrades PASS to FAIL when the latest run of a command failed or timed out", () => {
    expect(enforceVerdict(qa("PASS"), [run("npm test", "PASSED", 1), run("npm test", "FAILED", 2)]).verdict).toBe("FAIL");
    expect(enforceVerdict(qa("PASS"), [run("npm test", "PASSED", 1), run("npx vitest run", "TIMED_OUT", 2)]).verdict).toBe("FAIL");
  });
  it("uses the latest run per command", () => {
    expect(enforceVerdict(qa("PASS"), [run("npm test", "FAILED", 1), run("npm test", "PASSED", 2)]).verdict).toBe("PASS");
  });
  it("never upgrades FAIL", () => {
    expect(enforceVerdict(qa("FAIL"), [run("npm test", "PASSED", 1)]).verdict).toBe("FAIL");
  });
});

describe("validation", () => {
  const base = { workspaceId: "w", repositoryId: "r", title: "Checkout returns 500", description: "Users get a server error when paying with a saved card." };
  it("validates incident input and trims optional fields", () => {
    const v = createIncidentSchema.parse({ ...base, errorMessage: "   " });
    expect(v.errorMessage).toBeUndefined();
    expect(v.autoStart).toBe(true);
    expect(createIncidentSchema.safeParse({ ...base, title: "500" }).success).toBe(false);
    expect(createIncidentSchema.safeParse({ ...base, description: "broken" }).success).toBe(false);
    expect(createIncidentSchema.safeParse({ ...base, repositoryId: "" }).success).toBe(false);
  });
  it("requires a reason to reject, and defaults to opening a PR on approve", () => {
    expect(rejectSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "no tests" }).success).toBe(true);
    expect(approveSchema.parse({}).createPullRequest).toBe(true);
  });
  it("accepts well-formed agent reports and rejects malformed ones", () => {
    const triage = demoBrains.TRIAGE({ role: "TRIAGE", system: "", context: "", results: [], turn: 99, lastResult: "" });
    expect(triageReportSchema.safeParse((triage as { input: unknown }).input).success).toBe(true);
    expect(triageReportSchema.safeParse({ ...(triage as { input: object }).input, severity: "URGENT" }).success).toBe(false);
    const inv = demoBrains.INVESTIGATOR({ role: "INVESTIGATOR", system: "", context: "", results: [], turn: 99, lastResult: "" });
    expect(investigationReportSchema.safeParse((inv as { input: unknown }).input).success).toBe(true);
    expect(investigationReportSchema.safeParse({ ...(inv as { input: object }).input, evidence: [] }).success).toBe(false);
    expect(qaReportSchema.safeParse({ ...qa("PASS"), verdict: "MAYBE" }).success).toBe(false);
  });
});
