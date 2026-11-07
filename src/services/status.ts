import { config } from "@/src/lib/config";
import { getProvider } from "@/src/lib/ai";
import { getSwitch } from "@/src/lib/switch";
import { ensureRuntime } from "@/src/orchestration/runtime";

/** Safe-to-show integration status. Never includes secrets. */
export async function systemStatus() {
  let runtimeError: string | null = null;
  await ensureRuntime().catch((e) => (runtimeError = (e as Error).message));
  const c = config();
  const sw = getSwitch().status();
  const ai = getProvider().availability();
  return {
    switch: {
      mode: sw.mode,
      label: sw.label,
      connected: sw.healthy,
      detail: sw.detail,
      bridgeUrl: c.SWITCH_MODE === "live" ? c.SWITCH_BRIDGE_URL ?? null : null,
      identities: sw.identities.map((i) => ({ key: i.key, name: i.name, displayName: i.displayName, agentId: i.agentId, state: i.connection?.state ?? "not connected", rooms: i.connection?.rooms.length ?? 0, lastError: i.connection?.lastError || null })),
    },
    ai: { provider: c.AI_PROVIDER, available: ai.ok, detail: ai.ok ? "API key configured" : ai.reason, models: { TRIAGE: c.TRIAGE_MODEL, INVESTIGATOR: c.INVESTIGATOR_MODEL, FIXER: c.FIXER_MODEL, QA: c.QA_MODEL } },
    github: { oauthConfigured: !!(c.GITHUB_CLIENT_ID && c.GITHUB_CLIENT_SECRET) },
    execution: { mode: c.EXECUTION_MODE, timeoutMs: c.EXECUTION_TIMEOUT_MS, maxFixAttempts: c.MAX_FIX_ATTEMPTS },
    runtimeError,
  };
}
