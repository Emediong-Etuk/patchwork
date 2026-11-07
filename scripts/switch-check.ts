/**
 * Verifies PATCHWORK's connection to Switch end to end:
 *   1. GET /health on the agent bridge
 *   2. registers (or re-uses) the five PATCHWORK agent identities
 *   3. opens one event stream per identity
 *   4. creates an internal-only room with all five agents
 *   5. the relay @mentions the Triage agent; waits for Switch to deliver it
 *      to Triage's stream as an addressed event
 *
 * Usage: npm run switch:check   (reads .env; SWITCH_MODE=live for real Switch)
 */
import { config } from "@/src/lib/config";
import { getSwitch } from "@/src/lib/switch";
import { seedAgents } from "@/src/orchestration/runtime";

async function main() {
  const c = config();
  console.log(`Switch mode: ${c.SWITCH_MODE}${c.SWITCH_MODE === "live" ? ` (bridge ${c.SWITCH_BRIDGE_URL})` : " — this only exercises the local simulator, not Switch"}`);
  await seedAgents();
  const sw = getSwitch();
  const health = await sw.backend.health();
  console.log(`1. health: ${health.ok ? "ok" : "FAILED"} — ${health.detail}`);
  if (!health.ok) process.exit(1);

  let resolveDelivery: (seq: number) => void = () => {};
  const delivered = new Promise<number>((r) => (resolveDelivery = r));
  sw.onHandoff(async (h) => {
    if (h.role === "TRIAGE" && h.handoff.kind === "status" && h.handoff.incidentId === "connectivity-check") resolveDelivery(h.sequence);
  });
  sw.onRoomMessage(async () => {});

  await sw.start();
  console.log(`2. identities: ${sw.status().identities.map((i) => `${i.name}=${i.agentId.slice(0, 8)}`).join(", ")}`);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`3. streams: ${sw.status().identities.map((i) => `${i.name}:${i.connection?.state}`).join(", ")}`);

  const room = await sw.opAs<{ id: string; name: string }>("RELAY", "create_room", {
    name: `patchwork-connectivity-${Date.now()}`,
    description: "PATCHWORK connectivity check",
    agent_names: Object.values(sw.names()),
    internal_only: true,
  });
  console.log(`4. room: ${room.name} (${room.id})`);

  await sw.send("RELAY", room.id, "Connectivity check: please acknowledge.", ["TRIAGE"], { v: 1, incidentId: "connectivity-check", kind: "status", taskKey: "check:1:0", attempt: 1, from: "RELAY", to: "TRIAGE", ts: Date.now() });
  const seq = await Promise.race([delivered, new Promise<number>((_r, rej) => setTimeout(() => rej(new Error("timed out after 20s waiting for delivery")), 20_000))]);
  console.log(`5. delivery: Switch delivered the @mention to ${sw.names().TRIAGE}'s event stream (sequence ${seq}). ${sw.backend.mode === "live" ? "Switch integration OK." : "Simulator OK — set SWITCH_MODE=live to check a real Switch server."}`);
  await sw.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(`Switch check failed: ${(e as Error).message}`);
  process.exit(1);
});
