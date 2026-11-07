/**
 * Boots PATCHWORK's background runtime once per server process: seeds the four
 * agent records, connects every agent identity to Switch, wires deliveries to
 * the workflow, and recovers work interrupted by a restart.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { config } from "@/src/lib/config";
import { getSwitch } from "@/src/lib/switch";
import { AGENTS, AGENT_PROFILES, modelFor } from "@/src/agents/registry";
import { handleRoomMessage } from "./event-handler";
import { handleHandoff, recoverInterruptedIncidents } from "./workflow";

const g = globalThis as unknown as { __patchworkRuntime?: Promise<void>; __patchworkRecovered?: boolean };

export async function seedAgents() {
  const prefix = config().SWITCH_AGENT_PREFIX;
  for (const role of ["TRIAGE", "INVESTIGATOR", "FIXER", "QA"] as const) {
    const def = AGENTS[role];
    const profile = AGENT_PROFILES[role];
    const data = {
      name: def.displayName,
      role,
      title: def.title,
      description: profile.description,
      provider: config().AI_PROVIDER,
      model: modelFor(role),
      configuration: { tools: def.tools, effort: def.effort, capabilities: profile.capabilities } as Prisma.InputJsonValue,
    };
    await db.agent.upsert({ where: { id: profile.id }, create: { id: profile.id, switchName: `${prefix}-${role.toLowerCase()}`, ...data }, update: data });
  }
}

export function ensureRuntime(): Promise<void> {
  if (!g.__patchworkRuntime) {
    g.__patchworkRuntime = (async () => {
      await seedAgents();
      const sw = getSwitch();
      sw.onHandoff((h) => handleHandoff(h));
      sw.onRoomMessage((m) => handleRoomMessage(m));
      if (!g.__patchworkRecovered) {
        g.__patchworkRecovered = true;
        await recoverInterruptedIncidents();
      }
      try {
        await sw.start();
        console.log(`[patchwork] Switch ${sw.backend.mode}: ${sw.backend.label}; ${sw.status().identities.length} identities connected`);
      } catch (e) {
        // Keep the app usable; the status endpoint reports the problem and
        // starting an incident will retry the connection.
        console.error(`[patchwork] Switch connection failed: ${(e as Error).message}`);
      }
    })().catch((e) => {
      g.__patchworkRuntime = undefined;
      throw e;
    });
  }
  return g.__patchworkRuntime;
}
