/**
 * SwitchCollaboration: the one surface the rest of PATCHWORK uses to talk to
 * Switch. It owns the agent identities, keeps one event stream open per agent,
 * routes addressed handoffs to the workflow, and posts messages into incident
 * rooms with retries.
 */
import type { AgentRole } from "@prisma/client";
import { IDENTITY_SPECS, ensureIdentities, type IdentityKey } from "./agents";
import { decodeMessage, encodeMessage, type Handoff } from "./messages";
import { createIncidentRoom, type RoomIncident } from "./rooms";
import type { ConnectionStatus, CreatedRoom, DomainEvent, RoomContext, SwitchBackend, SwitchConnection, SwitchIdentity, SwitchMessagePayload } from "./types";

export type InboundHandoff = { role: AgentRole; handoff: Handoff; text: string; roomId: string; messageId: string; senderName: string; sequence: number; gapBefore: boolean };
export type InboundRoomMessage = { roomId: string; messageId: string; senderName: string; senderId: string; body: string; timestamp: number; fromPatchwork: boolean };

export type CollaborationStatus = {
  mode: SwitchBackend["mode"];
  label: string;
  healthy: boolean;
  detail: string;
  identities: { key: IdentityKey; name: string; displayName: string; agentId: string; connection: ConnectionStatus | null }[];
};

export class SwitchCollaboration {
  private identities = new Map<IdentityKey, SwitchIdentity>();
  private connections = new Map<IdentityKey, SwitchConnection>();
  private handoffHandler: ((h: InboundHandoff) => Promise<void>) | null = null;
  private roomMessageHandler: ((m: InboundRoomMessage) => Promise<void>) | null = null;
  private connectionListener: ((key: IdentityKey, s: ConnectionStatus) => void) | null = null;
  private seenMessages = new Set<string>();
  private started: Promise<void> | null = null;
  private lastHealth = { ok: false, detail: "not started" };

  constructor(
    readonly backend: SwitchBackend,
    private readonly opts: { prefix: string; scope: string; internalOnly: boolean; humanUserNames: string[] },
  ) {}

  onHandoff(fn: (h: InboundHandoff) => Promise<void>) {
    this.handoffHandler = fn;
  }
  onRoomMessage(fn: (m: InboundRoomMessage) => Promise<void>) {
    this.roomMessageHandler = fn;
  }
  onConnectionStatus(fn: (key: IdentityKey, s: ConnectionStatus) => void) {
    this.connectionListener = fn;
  }

  start(): Promise<void> {
    if (!this.started) {
      this.started = this.doStart().catch((e) => {
        this.started = null;
        this.lastHealth = { ok: false, detail: (e as Error).message };
        throw e;
      });
    }
    return this.started;
  }

  private async doStart() {
    this.lastHealth = await this.backend.health();
    if (!this.lastHealth.ok) throw new Error(this.lastHealth.detail);
    this.identities = await ensureIdentities(this.backend, this.opts.prefix, this.opts.scope);
    for (const spec of IDENTITY_SPECS) {
      const identity = this.identities.get(spec.key)!;
      // Agents only need what addresses them; the relay watches everything to
      // record what people say in the bridged chat.
      const filter = spec.key === "RELAY" ? "all" : "addressed";
      const conn = this.backend.connect(identity, { filter, scope: "all" }, {
        onEvent: (ev, meta) => this.dispatch(spec.key, ev, meta.gapBefore),
        onStatus: (s) => this.connectionListener?.(spec.key, s),
      });
      this.connections.set(spec.key, conn);
    }
  }

  get ready() {
    return this.identities.size === IDENTITY_SPECS.length;
  }

  names(): Record<IdentityKey, string> {
    const out = {} as Record<IdentityKey, string>;
    for (const spec of IDENTITY_SPECS) out[spec.key] = this.identities.get(spec.key)?.name ?? `${this.opts.prefix}-${spec.suffix}`;
    return out;
  }

  private keyForName(name: string): IdentityKey | null {
    for (const [k, v] of this.identities) if (v.name === name) return k;
    return null;
  }

  private async dispatch(key: IdentityKey, ev: DomainEvent, gapBefore: boolean) {
    if (ev.type !== "message") return;
    const p = ev.payload as unknown as SwitchMessagePayload;
    const senderKey = this.keyForName(p.sender_name);

    if (key === "RELAY") {
      const dedupe = `room:${p.message_id}`;
      if (this.seenMessages.has(dedupe)) return;
      this.remember(dedupe);
      await this.roomMessageHandler?.({ roomId: ev.room_id, messageId: p.message_id, senderName: p.sender_name, senderId: p.sender, body: p.body, timestamp: p.timestamp, fromPatchwork: senderKey !== null });
      return;
    }

    if (!p.addressed) return;
    const dedupe = `${key}:${p.message_id}`;
    if (this.seenMessages.has(dedupe)) return;
    this.remember(dedupe);
    const decoded = decodeMessage(p.body);
    // Work is only accepted from PATCHWORK's own identities with a valid signed
    // marker. Anyone else who @mentions an agent is recorded by the relay as a
    // human message and surfaced as context, but cannot drive the workflow.
    if (!senderKey || decoded.marker !== "valid" || !decoded.handoff) return;
    if (decoded.handoff.to !== key) return;
    await this.handoffHandler?.({ role: key as AgentRole, handoff: decoded.handoff, text: decoded.text, roomId: ev.room_id, messageId: p.message_id, senderName: p.sender_name, sequence: ev.sequence, gapBefore });
  }

  private remember(k: string) {
    this.seenMessages.add(k);
    if (this.seenMessages.size > 10_000) this.seenMessages = new Set([...this.seenMessages].slice(-5000));
  }

  async createRoom(incident: RoomIncident): Promise<CreatedRoom> {
    await this.start();
    return createIncidentRoom(this.backend, this.identities.get("RELAY")!, incident, this.names(), { internalOnly: this.opts.internalOnly, userNames: this.opts.humanUserNames });
  }

  /**
   * Post a message as one of PATCHWORK's identities. `to` identities are
   * @mentioned, which Switch delivers to them as addressed events.
   */
  async send(from: IdentityKey, roomId: string, text: string, to: IdentityKey[], handoff?: Handoff): Promise<{ messageId: string | null; body: string; attempts: number }> {
    await this.start();
    const identity = this.identities.get(from)!;
    const mentions = to.map((k) => this.identities.get(k)!.name);
    const body = encodeMessage(text, mentions, handoff);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const { messageId } = await this.backend.postMessage(identity, roomId, body);
        return { messageId, body, attempts: attempt };
      } catch (e) {
        lastErr = e;
        const status = (e as { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429) break; // not retryable
        await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
      }
    }
    throw new Error(`Switch message delivery failed: ${(lastErr as Error)?.message ?? "unknown error"}`);
  }

  /** Run an operation as one of PATCHWORK's identities (used by the connectivity check). */
  async opAs<T>(key: IdentityKey, name: string, args: Record<string, unknown>): Promise<T> {
    await this.start();
    return this.backend.op<T>(this.identities.get(key)!, name, args);
  }

  async readContext(roomId: string, limit = 30): Promise<RoomContext> {
    await this.start();
    return this.backend.op<RoomContext>(this.identities.get("RELAY")!, "read_context", { room_id: roomId, limit });
  }

  async participants(roomId: string) {
    await this.start();
    return this.backend.op<{ id: string; name: string; type: string; status: string | null }[]>(this.identities.get("RELAY")!, "list_participants", { room_id: roomId }).catch(() => []);
  }

  status(): CollaborationStatus {
    return {
      mode: this.backend.mode,
      label: this.backend.label,
      healthy: this.lastHealth.ok && this.ready,
      detail: this.lastHealth.detail,
      identities: IDENTITY_SPECS.map((spec) => {
        const id = this.identities.get(spec.key);
        return { key: spec.key, name: id?.name ?? `${this.opts.prefix}-${spec.suffix}`, displayName: spec.displayName, agentId: id?.agentId ?? "", connection: this.connections.get(spec.key)?.status() ?? null };
      }),
    };
  }

  async stop() {
    for (const c of this.connections.values()) await c.close();
    this.connections.clear();
    this.started = null;
  }
}
