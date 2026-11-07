/**
 * PATCHWORK messages are ordinary Switch room messages: readable text with
 * @mentions (which is what makes Switch deliver them as *addressed* events),
 * followed by one compact, signed handoff marker that the receiving agent
 * parses. Humans in the bridged chat see the text; agents act on the marker.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

export const HANDOFF_KINDS = ["incident.opened", "investigate", "fix", "verify", "qa.passed", "approval.requested", "human.note", "status"] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export const handoffSchema = z.object({
  v: z.literal(1),
  incidentId: z.string().min(1),
  kind: z.enum(HANDOFF_KINDS),
  taskKey: z.string().min(1).max(120),
  attempt: z.number().int().min(1).max(50),
  from: z.string().min(1),
  to: z.string().min(1).nullable(),
  ts: z.number().int(),
  data: z.record(z.unknown()).optional(),
});

export type Handoff = z.infer<typeof handoffSchema>;

const MARKER = /\n?\[pw:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})\]\s*$/;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required to sign Switch handoffs");
  return s;
}

function sig(payload: string) {
  return createHmac("sha256", secret()).update(`patchwork-handoff:${payload}`).digest("base64url").slice(0, 22);
}

export function encodeMessage(text: string, mentions: string[], handoff?: Handoff): string {
  const prefix = mentions.length ? mentions.map((m) => `@${m}`).join(" ") + " " : "";
  let body = `${prefix}${text.trim()}`;
  if (handoff) {
    const payload = Buffer.from(JSON.stringify(handoffSchema.parse(handoff))).toString("base64url");
    body += `\n[pw:${payload}.${sig(payload)}]`;
  }
  return body;
}

export type DecodedMessage = { text: string; handoff: Handoff | null; marker: "none" | "valid" | "invalid" };

export function decodeMessage(body: string): DecodedMessage {
  const m = body.match(MARKER);
  if (!m) return { text: body.trim(), handoff: null, marker: "none" };
  const text = body.slice(0, m.index).trim();
  const [, payload, signature] = m;
  const expected = sig(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return { text, handoff: null, marker: "invalid" };
  try {
    const parsed = handoffSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.success ? { text, handoff: parsed.data, marker: "valid" } : { text, handoff: null, marker: "invalid" };
  } catch {
    return { text, handoff: null, marker: "invalid" };
  }
}

/** Strip the leading @mentions for display. */
export function stripMentions(text: string): string {
  return text.replace(/^(@[a-z0-9][a-z0-9._-]*\s+)+/i, "");
}
