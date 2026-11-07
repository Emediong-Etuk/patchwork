import { config } from "@/src/lib/config";
import { SwitchCollaboration } from "./adapter";
import { HttpSwitchBackend } from "./client";
import { SimulatedSwitchBackend } from "./simulator";
import type { SwitchBackend } from "./types";

export { SwitchCollaboration } from "./adapter";
export type { InboundHandoff, InboundRoomMessage, CollaborationStatus } from "./adapter";
export * from "./types";
export { encodeMessage, decodeMessage, stripMentions, type Handoff, type HandoffKind } from "./messages";

const g = globalThis as unknown as { __patchworkSwitch?: SwitchCollaboration };

export function createBackend(): SwitchBackend {
  const c = config();
  if (c.SWITCH_MODE === "live") {
    if (!c.SWITCH_BRIDGE_URL) throw new Error("SWITCH_MODE=live requires SWITCH_BRIDGE_URL (the Switch agent bridge base URL)");
    return new HttpSwitchBackend(c.SWITCH_BRIDGE_URL, c.SWITCH_REGISTRATION_TOKEN);
  }
  return new SimulatedSwitchBackend();
}

export function getSwitch(): SwitchCollaboration {
  if (!g.__patchworkSwitch) {
    const c = config();
    const backend = createBackend();
    g.__patchworkSwitch = new SwitchCollaboration(backend, {
      prefix: c.SWITCH_AGENT_PREFIX,
      scope: backend.mode === "live" ? `live:${c.SWITCH_BRIDGE_URL}` : "simulator",
      internalOnly: c.SWITCH_ROOM_INTERNAL_ONLY === "true",
      humanUserNames: c.SWITCH_HUMAN_USERNAMES.split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  return g.__patchworkSwitch;
}

/** Test hook. */
export function setSwitchForTests(s: SwitchCollaboration | undefined) {
  g.__patchworkSwitch = s;
}
