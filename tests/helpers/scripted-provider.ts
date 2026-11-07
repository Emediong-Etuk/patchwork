/**
 * TEST-ONLY deterministic stand-in for the LLM. Each "agent brain" is a small
 * function that looks at the conversation so far (including the REAL output of
 * the tools PATCHWORK executed) and decides the next tool call. Everything
 * except the model — Switch messaging, git, file edits, test execution,
 * evidence verification, state transitions — runs for real.
 */
import type { ConversationOptions, LLMConversation, LLMProvider, ToolResult, Turn } from "@/src/lib/ai/types";

export type Step = { tool: string; input: Record<string, unknown> } | { text: string };
export type BrainState = { role: string; system: string; context: string; results: ToolResult[][]; turn: number; lastResult: string };
export type Brain = (s: BrainState) => Step;

export class ScriptedProvider implements LLMProvider {
  readonly name = "scripted-test";
  calls: { role: string; model: string; turn: number }[] = [];
  constructor(private readonly brains: Record<string, Brain>) {}
  availability() {
    return { ok: true as const };
  }
  startConversation(opts: ConversationOptions): LLMConversation {
    const role = (opts.system.match(/You are (PATCHWORK_\w+)/)?.[1] ?? "unknown").replace("PATCHWORK_", "").toUpperCase();
    const consult = opts.system.includes("The supervising developer sent you a message");
    const key = consult ? `${role}:consult` : role;
    const brain = this.brains[key];
    if (!brain) throw new Error(`No scripted brain for ${key}`);
    const state: BrainState = { role: key, system: opts.system, context: opts.userText, results: [], turn: 0, lastResult: "" };
    const calls = this.calls;
    let id = 0;
    return {
      async next(): Promise<Turn> {
        state.turn++;
        calls.push({ role: key, model: opts.model, turn: state.turn });
        const step = brain(state);
        if ("text" in step) return { stopReason: "end_turn", text: step.text, toolCalls: [], model: opts.model };
        return { stopReason: "tool_use", text: "", toolCalls: [{ id: `call_${++id}`, name: step.tool, input: step.input }], model: opts.model };
      },
      addToolResults(results: ToolResult[]) {
        state.results.push(results);
        state.lastResult = results.map((r) => r.content).join("\n");
      },
      addUserText() {
        /* scripted brains ignore nudges */
      },
    };
  }
}

/** A brain that runs a fixed list of steps, then submits whatever `submit` builds. */
export function sequence(steps: Step[], submit: (s: BrainState) => Record<string, unknown>): Brain {
  return (s) => (s.turn <= steps.length ? steps[s.turn - 1] : { tool: "submit_report", input: submit(s) });
}

export const demoBrains = {
  TRIAGE: sequence([{ tool: "list_files", input: { path: "." } }], () => ({
    title: "Registration endpoint returns HTTP 500",
    description: "POST /api/register fails with a server error instead of creating the account.",
    severity: "HIGH",
    severityRationale: "New users cannot sign up; core onboarding is broken with no workaround.",
    classification: "server error",
    affectedFunctionality: ["User registration"],
    suspectedComponents: ["src/auth/register.js", "src/users/store.js"],
    initialHypothesis: "The registration handler may throw while building its response.",
    investigationPlan: ["Locate the registration handler", "Run the test suite to reproduce", "Trace the user object returned by the store"],
    delegatedTasks: [{ agent: "INVESTIGATOR", task: "Find why POST /api/register returns 500 and reproduce it with the tests." }],
    missingInformation: ["Server logs from production"],
    needsMoreInformation: false,
  })),
  INVESTIGATOR: sequence(
    [
      { tool: "search_code", input: { query: "/api/register" } },
      { tool: "read_file", input: { path: "src/auth/register.js" } },
      { tool: "read_file", input: { path: "src/users/store.js" } },
      { tool: "run_tests", input: { command: "npm test" } },
    ],
    () => ({
      summary: "handleRegister reads user.profile.displayName but UserStore.createUser never creates a profile, so registration throws a TypeError that the server turns into HTTP 500.",
      reproduction: { attempted: true, command: "npm test", reproduced: true, details: "4 registration tests fail with TypeError: Cannot read properties of undefined (reading 'displayName')." },
      reproductionSteps: ["POST /api/register with a valid email and password", "Observe HTTP 500"],
      relevantFiles: [
        { path: "src/auth/register.js", reason: "Builds the response" },
        { path: "src/users/store.js", reason: "Creates the user record" },
      ],
      codeLocations: [
        { path: "src/auth/register.js", lineStart: 9, lineEnd: 9, description: "Reads user.profile.displayName" },
        { path: "src/users/store.js", lineStart: 21, lineEnd: 28, description: "createUser returns a record without profile" },
      ],
      observedBehavior: "HTTP 500 Internal server error",
      expectedBehavior: "HTTP 201 with { id, email, displayName, createdAt }",
      rootCause: "UserStore.createUser does not initialise user.profile, but toPublicUser dereferences user.profile.displayName.",
      evidence: [
        { type: "CODE_REFERENCE", title: "Response reads profile.displayName", description: "toPublicUser assumes a profile exists", filePath: "src/auth/register.js", lineStart: 9, lineEnd: 9, excerpt: "displayName: user.profile.displayName," },
        { type: "CODE_REFERENCE", title: "createUser omits profile", description: "No profile property is set", filePath: "src/users/store.js", lineStart: 22, lineEnd: 27, excerpt: "const user = {\n      id: crypto.randomUUID(),\n      email,\n      passwordHash," },
        { type: "TEST_RESULT", title: "Registration tests fail", description: "Reproduced", command: "npm test", excerpt: "Cannot read properties of undefined (reading 'displayName')" },
        { type: "CODE_REFERENCE", title: "Fabricated reference", description: "Deliberately wrong to exercise verification", filePath: "src/auth/register.js", lineStart: 3, lineEnd: 3, excerpt: "const profile = createProfile(user);" },
      ],
      confidence: "high",
      hypotheses: ["Production traffic sees the same error"],
      recommendedFix: "Initialise profile in UserStore.createUser using defaultDisplayName(email, name).",
    }),
  ),
  FIXER: (s: BrainState): Step => {
    const retry = /This is fix attempt (\d+)/.exec(s.context);
    if (!retry) {
      // Attempt 1: the tempting null-safe patch.
      const steps: Step[] = [
        { tool: "read_file", input: { path: "src/auth/register.js" } },
        { tool: "replace_in_file", input: { path: "src/auth/register.js", old_text: "displayName: user.profile.displayName,", new_text: "displayName: user.profile?.displayName," } },
      ];
      if (s.turn <= steps.length) return steps[s.turn - 1];
      return { tool: "submit_report", input: { rootCauseAddressed: "Guard against a missing profile when building the response.", filesModified: [{ path: "src/auth/register.js", description: "Optional chaining on profile" }], summary: "Use optional chaining for user.profile in toPublicUser.", whyItWorks: "Prevents the TypeError.", potentialSideEffects: ["displayName may be undefined"], testsToRun: ["npm test"] } };
    }
    const steps: Step[] = [
      { tool: "read_file", input: { path: "src/users/store.js" } },
      { tool: "replace_in_file", input: { path: "src/users/store.js", old_text: "      createdAt: new Date().toISOString(),\n    };", new_text: '      createdAt: new Date().toISOString(),\n      profile: { displayName: defaultDisplayName(email, name), bio: "", avatarUrl: null },\n    };' } },
      { tool: "replace_in_file", input: { path: "src/auth/register.js", old_text: "displayName: user.profile?.displayName,", new_text: "displayName: user.profile.displayName," } },
    ];
    if (s.turn <= steps.length) return steps[s.turn - 1];
    return { tool: "submit_report", input: { rootCauseAddressed: "createUser now initialises the profile, so every user has one.", filesModified: [{ path: "src/users/store.js", description: "Create profile with default display name" }, { path: "src/auth/register.js", description: "Revert optional chaining" }], summary: "Initialise user.profile in UserStore.createUser and restore the direct access.", whyItWorks: "The profile now always exists with the documented defaults.", potentialSideEffects: [], testsToRun: ["npm test"], respondedToFeedback: "QA showed displayName undefined and missing profile; the store now creates it." } };
  },
  QA: (s: BrainState): Step => {
    if (s.turn === 1) return { tool: "view_diff", input: {} };
    if (s.turn === 2) return { tool: "run_tests", input: { command: "npm test" } };
    const passed = /status: PASSED/.test(s.lastResult);
    const out = s.lastResult.slice(0, 1500);
    return {
      tool: "submit_report",
      input: passed
        ? { verdict: "PASS", testSummary: "All 8 tests pass.", commandsExecuted: ["npm test"], testsPassed: 8, testsFailed: 0, relevantOutput: out, regressionAnalysis: "No other behaviour changed.", implementationReview: "Profile initialised in createUser.", outstandingConcerns: [], recommendation: "Approve." }
        : { verdict: "FAIL", testSummary: "Registration tests still fail.", commandsExecuted: ["npm test"], testsFailed: 3, relevantOutput: out, regressionAnalysis: "displayName is undefined and the profile endpoint 404s.", implementationReview: "Optional chaining hides the error but no profile is created.", outstandingConcerns: [], failureDetailsForFixer: "displayName is undefined; GET /api/users/:id/profile returns 404. Create the profile at registration.", recommendation: "Return to Fixer." },
    };
  },
  "TRIAGE:consult": sequence([], () => ({ reply: "Understood: the API response format will not change.", instructionAcknowledged: true })),
} satisfies Record<string, Brain>;
