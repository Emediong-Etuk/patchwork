/**
 * Translates Switch room events (seen by the relay identity's stream) into
 * PATCHWORK records:
 *  - PATCHWORK's own messages coming back through Switch mark the stored
 *    message as delivered (proof of the round trip, with the Switch sequence).
 *  - Messages from anyone else (people in Slack/Mattermost/Discord, or other
 *    agents) are stored as room messages and shared with later agent tasks.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { emitEvent } from "@/src/lib/events/bus";
import { decodeMessage, stripMentions, type InboundRoomMessage } from "@/src/lib/switch";
import { redact } from "@/src/lib/security/redact";
import { bodyHash } from "@/src/services/room-messages";

export async function handleRoomMessage(m: InboundRoomMessage) {
  const incident = await db.incident.findFirst({ where: { switchRoomId: m.roomId } });
  if (!incident) return;

  if (m.fromPatchwork) {
    const hash = bodyHash(m.roomId, m.body);
    const candidates = await db.agentMessage.findMany({ where: { incidentId: incident.id }, orderBy: { createdAt: "desc" }, take: 50 });
    const match = candidates.find((c) => (c.metadata as { switch?: { bodyHash?: string; delivered?: boolean } })?.switch?.bodyHash === hash && !(c.metadata as { switch?: { delivered?: boolean } }).switch?.delivered);
    if (match) {
      const meta = match.metadata as Record<string, Record<string, unknown>>;
      meta.switch = { ...meta.switch, delivered: true, observedMessageId: m.messageId, observedAt: m.timestamp };
      await db.agentMessage.update({ where: { id: match.id }, data: { metadata: meta as Prisma.InputJsonValue, switchMessageId: match.switchMessageId ?? m.messageId } }).catch(() => undefined);
    }
    return;
  }

  const text = redact(stripMentions(decodeMessage(m.body).text));
  try {
    const msg = await db.agentMessage.create({
      data: { incidentId: incident.id, senderType: "HUMAN", senderName: m.senderName || "Room participant", messageType: "HUMAN", content: text, switchMessageId: m.messageId, metadata: { source: "switch-room", senderId: m.senderId } },
    });
    await emitEvent({ incidentId: incident.id, workspaceId: incident.workspaceId, actorType: "USER", eventType: "HUMAN_MESSAGE", description: `${msg.senderName} (in the Switch room): ${text.slice(0, 140)}`, metadata: { messageId: msg.id, source: "switch-room" } });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e; // duplicate delivery
  }
}
