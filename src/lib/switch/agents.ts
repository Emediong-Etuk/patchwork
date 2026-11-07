import type { AgentRole } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { decryptSecret, encryptSecret } from "@/src/lib/security/crypto";
import { registerSecret } from "@/src/lib/security/redact";
import { SwitchError, type SwitchBackend, type SwitchIdentity } from "./types";

export type IdentityKey = AgentRole | "RELAY";

export type IdentitySpec = { key: IdentityKey; suffix: string; displayName: string; description: string };

export const IDENTITY_SPECS: IdentitySpec[] = [
  { key: "TRIAGE", suffix: "triage", displayName: "PATCHWORK_Triage", description: "PATCHWORK incident coordinator: classifies bug reports, sets severity, plans and delegates the investigation." },
  { key: "INVESTIGATOR", suffix: "investigator", displayName: "PATCHWORK_Investigator", description: "PATCHWORK debugging engineer: reads the repository, reproduces failures and reports evidence-backed root causes." },
  { key: "FIXER", suffix: "fixer", displayName: "PATCHWORK_Fixer", description: "PATCHWORK software engineer: implements the smallest safe fix on an isolated branch." },
  { key: "QA", suffix: "qa", displayName: "PATCHWORK_QA", description: "PATCHWORK QA engineer: independently inspects the patch and runs the tests." },
  { key: "RELAY", suffix: "relay", displayName: "PATCHWORK Console", description: "Relays incident reports and developer messages from the PATCHWORK web app into the incident room." },
];

export function switchName(prefix: string, spec: IdentitySpec) {
  return `${prefix}-${spec.suffix}`;
}

/**
 * Load each identity's stored Switch credentials, verify them, and register
 * (or re-register) any that are missing or rejected. API keys are stored
 * encrypted and never leave the server.
 */
export async function ensureIdentities(backend: SwitchBackend, prefix: string, scope: string): Promise<Map<IdentityKey, SwitchIdentity>> {
  const out = new Map<IdentityKey, SwitchIdentity>();
  for (const spec of IDENTITY_SPECS) {
    const name = switchName(prefix, spec);
    const credScope = `${scope}|${name}`;
    let identity: SwitchIdentity | null = null;

    if (backend.mode === "live") {
      const stored = await db.credential.findUnique({ where: { kind_scope: { kind: "SWITCH_AGENT", scope: credScope } } });
      if (stored) {
        try {
          const { agentId, apiKey } = JSON.parse(decryptSecret(stored.ciphertext)) as { agentId: string; apiKey: string };
          const candidate = { name, displayName: spec.displayName, description: spec.description, agentId, apiKey };
          if (await backend.verify(candidate)) identity = candidate;
        } catch (e) {
          console.warn(`[switch] stored credentials for ${name} unusable: ${(e as Error).message}`);
        }
      }
    }

    if (!identity) {
      let reg: { id: string; apiKey: string };
      try {
        reg = await backend.register({ name, displayName: spec.displayName, description: spec.description }, { overwrite: false });
      } catch (e) {
        // 409: already registered but we hold no working key. We own these agents, so rotate.
        if (e instanceof SwitchError && e.status === 409) reg = await backend.register({ name, displayName: spec.displayName, description: spec.description }, { overwrite: true });
        else throw e;
      }
      identity = { name, displayName: spec.displayName, description: spec.description, agentId: reg.id, apiKey: reg.apiKey };
      if (backend.mode === "live") {
        const ciphertext = encryptSecret(JSON.stringify({ agentId: reg.id, apiKey: reg.apiKey }));
        await db.credential.upsert({
          where: { kind_scope: { kind: "SWITCH_AGENT", scope: credScope } },
          create: { kind: "SWITCH_AGENT", scope: credScope, ciphertext },
          update: { ciphertext },
        });
      }
    }
    registerSecret(identity.apiKey);
    out.set(spec.key, identity);
    if (spec.key !== "RELAY") await db.agent.updateMany({ where: { role: spec.key }, data: { switchAgentId: identity.agentId, switchName: name } });
  }
  return out;
}
