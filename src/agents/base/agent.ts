/**
 * Common agent contract and execution loop.
 *
 * Every PATCHWORK agent has an identity, role, instructions, a fixed tool set
 * and an output schema. The loop drives the model through tool calls until it
 * calls `submit_report`, validates the report with Zod, and asks the model to
 * fix invalid reports. It never invents a result: if the model cannot produce
 * a valid report the run fails with a clear error.
 */
import type { AgentRole } from "@prisma/client";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { emitEvent } from "@/src/lib/events/bus";
import { AIProviderUnavailableError, type LLMProvider, type ToolResult, type ToolSpec } from "@/src/lib/ai/types";
import { UNTRUSTED_POLICY } from "@/src/lib/security/untrusted";
import { executeTool, TOOLS, type ToolContext, type ToolName } from "./tools";

export type AgentDefinition<T> = {
  role: AgentRole;
  displayName: string;
  title: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  instructions: string;
  outputSchema: ZodType<T>;
  outputDescription: string;
  tools: ToolName[];
};

export class InvalidAgentResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAgentResponseError";
  }
}

export class AgentTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTimeoutError";
  }
}

export type AgentRunResult<T> = { report: T; steps: number; toolCalls: { name: string; summary: string; isError: boolean }[]; model: string };

export function systemPrompt(def: AgentDefinition<unknown>): string {
  return [
    `You are ${def.displayName}, the ${def.title} on PATCHWORK, a team of four specialised AI agents (Triage, Investigator, Fixer, QA) that collaborate through a shared Switch room to take a software bug from report to verified fix. A human developer supervises and makes the final decision.`,
    "",
    def.instructions,
    "",
    UNTRUSTED_POLICY,
    "",
    "Evidence discipline:",
    "- Base conclusions on what you actually observed through your tools. Quote exact file paths, line numbers and output.",
    "- Distinguish verified facts from hypotheses. Never invent files, functions, logs, stack traces or test results.",
    "- PATCHWORK independently re-checks your code references and test claims against the repository and the recorded command output.",
    "",
    `When you are done, call the submit_report tool exactly once with your ${def.outputDescription}. Do not write the report as plain text.`,
  ].join("\n");
}

const SUBMIT = "submit_report";

export async function runAgent<T>(
  def: AgentDefinition<T>,
  opts: { provider: LLMProvider; model: string; context: string; toolCtx: ToolContext; maxSteps: number; timeoutMs: number; signal?: AbortSignal },
): Promise<AgentRunResult<T>> {
  const availability = opts.provider.availability();
  if (!availability.ok) throw new AIProviderUnavailableError(availability.reason);

  const outputJsonSchema = zodToJsonSchema(def.outputSchema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete outputJsonSchema.$schema;
  const tools: ToolSpec[] = [
    ...def.tools.map((t) => TOOLS[t].spec),
    { name: SUBMIT, description: `Submit your final ${def.outputDescription}. Call once, at the end.`, inputSchema: outputJsonSchema },
  ];

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => controller.abort(new AgentTimeoutError(`${def.displayName} exceeded ${Math.round(opts.timeoutMs / 1000)}s`)), opts.timeoutMs);

  const conversation = opts.provider.startConversation({ model: opts.model, system: systemPrompt(def), userText: opts.context, tools, effort: def.effort });
  const toolCalls: AgentRunResult<T>["toolCalls"] = [];
  let invalidReports = 0;
  let nudges = 0;
  let model = opts.model;

  try {
    for (let step = 1; step <= opts.maxSteps; step++) {
      if (controller.signal.aborted) throw controller.signal.reason instanceof Error ? controller.signal.reason : new AgentTimeoutError(`${def.displayName} was stopped`);
      const turn = await conversation.next(controller.signal);
      model = turn.model;

      if (turn.stopReason === "refusal") throw new InvalidAgentResponseError(`${def.displayName}'s model declined the request (refusal).`);

      if (!turn.toolCalls.length) {
        if (++nudges > 2) throw new InvalidAgentResponseError(`${def.displayName} stopped without submitting a report.`);
        conversation.addUserText(turn.stopReason === "max_tokens" ? "Your last response was cut off. Continue, and finish by calling submit_report." : "Continue your work with the tools, and finish by calling submit_report with your report.");
        continue;
      }

      const results: ToolResult[] = [];
      let accepted: T | null = null;
      for (const call of turn.toolCalls) {
        if (call.name === SUBMIT) {
          const parsed = def.outputSchema.safeParse(call.input);
          if (parsed.success) {
            accepted = parsed.data;
            results.push({ id: call.id, content: "Report accepted." });
          } else {
            invalidReports++;
            const issues = parsed.error.issues.slice(0, 12).map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
            results.push({ id: call.id, isError: true, content: `Report rejected by schema validation. Fix these issues and call submit_report again:\n${issues}` });
          }
          continue;
        }
        const outcome = await executeTool(call.name, def.tools, call.input, opts.toolCtx);
        toolCalls.push({ name: call.name, summary: outcome.summary, isError: !!outcome.isError });
        await emitEvent({
          incidentId: opts.toolCtx.incidentId,
          workspaceId: opts.toolCtx.workspaceId,
          actorType: "AGENT",
          actorId: opts.toolCtx.agentId,
          eventType: "AGENT_TOOL_CALL",
          description: `${def.displayName} ${outcome.summary}`,
          metadata: { tool: call.name, isError: !!outcome.isError, attempt: opts.toolCtx.attempt },
        }).catch(() => undefined);
        results.push({ id: call.id, content: outcome.content, isError: outcome.isError });
      }
      if (accepted) return { report: accepted, steps: step, toolCalls, model };
      if (invalidReports > 3) throw new InvalidAgentResponseError(`${def.displayName} submitted ${invalidReports} invalid reports.`);
      conversation.addToolResults(results);
    }
    throw new InvalidAgentResponseError(`${def.displayName} did not finish within ${opts.maxSteps} steps.`);
  } catch (e) {
    if (controller.signal.aborted && controller.signal.reason instanceof AgentTimeoutError) throw controller.signal.reason;
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
