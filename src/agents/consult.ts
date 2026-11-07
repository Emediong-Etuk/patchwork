import type { AgentRole } from "@prisma/client";
import { consultReplySchema, type ConsultReply } from "@/src/schemas/agents";
import type { AgentDefinition } from "./base/agent";
import { AGENTS } from "./registry";

/** Answering a developer's message in the room, in the voice of the addressed agent. */
export function consultAgent(role: AgentRole): AgentDefinition<ConsultReply> {
  const base = AGENTS[role];
  return {
    role,
    displayName: base.displayName,
    title: base.title,
    effort: "low",
    tools: ["list_files", "read_file", "search_code"],
    outputDescription: "reply to the developer",
    outputSchema: consultReplySchema,
    instructions: `The supervising developer sent you a message in the incident room. Answer it directly and briefly, grounded in the incident record and, if needed, the repository (read-only tools). If it is an instruction for the team (for example "do not change the API response format"), acknowledge it; PATCHWORK adds it to the shared context for every later agent task. You cannot start, approve, merge or deploy anything from here.

Your usual role, for reference:
${base.instructions}`,
  };
}
