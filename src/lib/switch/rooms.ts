import type { SwitchBackend, SwitchIdentity, CreatedRoom } from "./types";

export type RoomIncident = { number: number; title: string; repositoryFullName: string; severity?: string | null };

export function roomBriefing(incident: RoomIncident, names: Record<string, string>): string {
  return [
    `PATCHWORK incident room for INC-${incident.number}: ${incident.title} (repository ${incident.repositoryFullName}).`,
    "",
    "How this room works:",
    `- @${names.TRIAGE} coordinates: it classifies the report and delegates work.`,
    `- @${names.INVESTIGATOR} inspects the repository read-only and reports the root cause with evidence.`,
    `- @${names.FIXER} implements the smallest safe fix on an isolated branch (patchwork/incident-...-fix).`,
    `- @${names.QA} independently inspects the patch and runs the tests. Failures go back to the Fixer.`,
    `- @${names.RELAY} relays the developer's messages from the PATCHWORK web app.`,
    "",
    "Rules: nothing is merged or deployed without explicit human approval. Agents never claim a test passed unless it was executed.",
    "Each agent message ends with a signed [pw:...] handoff marker that PATCHWORK uses to route work; it carries no secrets.",
  ].join("\n");
}

export async function createIncidentRoom(
  backend: SwitchBackend,
  relay: SwitchIdentity,
  incident: RoomIncident,
  names: Record<string, string>,
  opts: { internalOnly: boolean; userNames: string[] },
): Promise<CreatedRoom> {
  const args: Record<string, unknown> = {
    name: `patchwork-inc-${incident.number}`,
    description: `INC-${incident.number}: ${incident.title}`.slice(0, 250),
    agent_names: [names.RELAY, names.TRIAGE, names.INVESTIGATOR, names.FIXER, names.QA],
    instructions: roomBriefing(incident, names),
    internal_only: opts.internalOnly,
  };
  if (!opts.internalOnly) args.channel_type = "channel_public";
  if (!opts.internalOnly && opts.userNames.length) args.user_names = opts.userNames;
  const result = await backend.op<{ id: string; name: string; transport_room_id?: string | null; caller_is_member?: boolean }>(relay, "create_room", args);
  if (!result?.id) throw new Error("Switch create_room returned no room id");
  return { id: result.id, name: result.name, transportRoomId: result.transport_room_id ?? null, callerIsMember: result.caller_is_member };
}
