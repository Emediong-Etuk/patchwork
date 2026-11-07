/**
 * Posting into an incident's Switch room and recording what was said.
 */
import { createHash, randomBytes } from "crypto";
import type { AgentRole, MessageType, Prisma } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { emitEvent } from "@/src/lib/events/bus";
import { getSwitch, stripMentions, type Handoff, type HandoffKind } from "@/src/lib/switch";
import type { IdentityKey } from "@/src/lib/switch/agents";
import { redact } from "@/src/lib/security/redact";
import { agentIdFor, roleName } from "@/src/orchestration/task-manager";

export const bodyHash = (roomId: string, body: string) => createHash("sha256").update(`${roomId}\n${body}`).digest("hex").slice(0, 32);

export function newTaskKey(stage: string, attempt: number) {
  return `${stage}:${attempt}:${randomBytes(4).toString("hex")}`;
}

export type PostInput = {
  incident: { id: string; workspaceId: string; switchRoomId: string | null };
  from: IdentityKey;
  to: IdentityKey[];
  text: string;
  messageType: MessageType;
  handoff?: { kind: HandoffKind; taskKey: string; attempt: number; data?: Record<string, unknown> };
  humanSender?: { userId: string; name: string };
};

/** Sends through Switch, then persists. Throws if Switch delivery fails. */
export async function postToRoom(input: PostInput) {
  const sw = getSwitch();
  if (!input.incident.switchRoomId) throw new Error("Incident has no Switch room yet");
  const text = redact(input.text);
  const handoff: Handoff | undefined = input.handoff
    ? { v: 1, incidentId: input.incident.id, kind: input.handoff.kind, taskKey: input.handoff.taskKey, attempt: input.handoff.attempt, from: input.from, to: input.to[0] ?? null, ts: Date.now(), data: input.handoff.data }
    : undefined;
  const sent = await sw.send(input.from, input.incident.switchRoomId, text, input.to, handoff);
  const names = sw.names();
  const fromAgent = input.from === "RELAY" ? null : (input.from as AgentRole);
  const metadata = {
    to: input.to.map((k) => (k === "RELAY" ? "PATCHWORK Console" : roleName(k as AgentRole))),
    mentions: input.to.map((k) => names[k]),
    handoff: handoff ? { kind: handoff.kind, taskKey: handoff.taskKey, attempt: handoff.attempt } : null,
    switch: { mode: sw.backend.mode, roomId: input.incident.switchRoomId, messageId: sent.messageId, deliveryAttempts: sent.attempts, bodyHash: bodyHash(input.incident.switchRoomId, sent.body), delivered: false },
    relayedFor: input.humanSender ?? null,
  };
  const msg = await db.agentMessage.create({
    data: {
      incidentId: input.incident.id,
      agentId: fromAgent ? agentIdFor(fromAgent) : null,
      senderType: input.humanSender ? "HUMAN" : fromAgent ? "AGENT" : "SYSTEM",
      senderName: input.humanSender ? input.humanSender.name : fromAgent ? roleName(fromAgent) : "PATCHWORK Console",
      messageType: input.messageType,
      content: stripMentions(text),
      metadata: metadata as Prisma.InputJsonValue,
      switchMessageId: sent.messageId,
    },
  });
  await emitEvent({
    incidentId: input.incident.id,
    workspaceId: input.incident.workspaceId,
    actorType: input.humanSender ? "USER" : fromAgent ? "AGENT" : "SYSTEM",
    actorId: input.humanSender?.userId ?? (fromAgent ? agentIdFor(fromAgent) : null),
    eventType: input.humanSender ? "HUMAN_MESSAGE" : "AGENT_MESSAGE",
    description: `${msg.senderName}${metadata.to.length ? ` → ${metadata.to.join(", ")}` : ""}: ${msg.content.slice(0, 140)}`,
    metadata: { messageId: msg.id, messageType: input.messageType, handoff: metadata.handoff },
  });
  if (handoff && handoff.kind !== "status" && handoff.kind !== "human.note" && input.to[0] && input.to[0] !== "RELAY") {
    await emitEvent({
      incidentId: input.incident.id,
      workspaceId: input.incident.workspaceId,
      actorType: fromAgent ? "AGENT" : "SYSTEM",
      actorId: fromAgent ? agentIdFor(fromAgent) : null,
      eventType: "TASK_ASSIGNED",
      description: `${fromAgent ? roleName(fromAgent) : "PATCHWORK Console"} handed ${handoff.kind} (attempt ${handoff.attempt}) to ${metadata.to[0]} via Switch`,
      metadata: { taskKey: handoff.taskKey, kind: handoff.kind, to: input.to[0] },
    });
  }
  return msg;
}

/** Best-effort post for notices; a delivery failure is recorded, not thrown. */
export async function postNotice(input: Omit<PostInput, "handoff">) {
  try {
    return await postToRoom(input);
  } catch (e) {
    await emitEvent({ incidentId: input.incident.id, workspaceId: input.incident.workspaceId, actorType: "SYSTEM", eventType: "WORKFLOW_ERROR", description: `Could not post to the Switch room: ${(e as Error).message}` });
    return null;
  }
}
