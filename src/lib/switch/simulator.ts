/**
 * LOCAL DEVELOPMENT SIMULATOR — NOT SWITCH.
 *
 * An in-process stand-in that mimics the documented semantics of the Switch
 * agent protocol (rooms, membership, @mention addressing, per-agent sequenced
 * event buffers, connection_state, read_context) so PATCHWORK can be developed
 * and tested without a Switch deployment. Everything routed through it is
 * labelled "Simulated" in the UI and in stored metadata. Set SWITCH_MODE=live
 * with SWITCH_BRIDGE_URL and SWITCH_REGISTRATION_TOKEN to use real Switch.
 */
import { randomUUID } from "crypto";
import {
  SwitchError,
  type AgentRegistration,
  type ConnectionHandlers,
  type ConnectionStatus,
  type DeliveryFilter,
  type DeliveryScope,
  type DomainEvent,
  type SwitchBackend,
  type SwitchConnection,
  type SwitchIdentity,
  type SwitchMessagePayload,
} from "./types";

type SimAgent = { id: string; name: string; displayName: string; apiKey: string; seq: number; buffer: DomainEvent[] };
type SimRoom = { id: string; name: string; description: string; instructions: string; members: Set<string>; timeline: { id: string; kind: string; sender: string; sender_name: string; body: string; timestamp: number }[] };

const SERVER = "patchwork.simulator";

export class SimulatedSwitchBackend implements SwitchBackend {
  readonly mode = "simulator" as const;
  readonly label = "Local Switch simulator (not connected to Switch)";
  private agents = new Map<string, SimAgent>(); // by id
  private rooms = new Map<string, SimRoom>();
  private connections = new Set<SimConnection>();
  /** Test hook: make the next N postMessage calls fail like a dropped bridge. */
  failNextPosts = 0;

  async health() {
    return { ok: true, detail: this.label };
  }

  async register(reg: AgentRegistration, opts: { overwrite: boolean }) {
    const existing = [...this.agents.values()].find((a) => a.name === reg.name);
    if (existing && !opts.overwrite) throw new SwitchError(`Agent ${reg.name} already exists`, 409);
    const agent: SimAgent = existing ?? { id: randomUUID(), name: reg.name, displayName: reg.displayName, apiKey: "", seq: 0, buffer: [] };
    agent.apiKey = `sim_${randomUUID().replaceAll("-", "")}`;
    this.agents.set(agent.id, agent);
    return { id: agent.id, apiKey: agent.apiKey };
  }

  async verify(identity: SwitchIdentity) {
    return this.agents.get(identity.agentId)?.apiKey === identity.apiKey;
  }

  private auth(identity: SwitchIdentity): SimAgent {
    const a = this.agents.get(identity.agentId);
    if (!a || a.apiKey !== identity.apiKey) throw new SwitchError("Unauthorized", 401);
    return a;
  }

  private participantId(a: SimAgent) {
    return `@switch-agent-${a.id.slice(0, 8)}:${SERVER}`;
  }

  async op<T>(identity: SwitchIdentity, name: string, args: Record<string, unknown>): Promise<T> {
    const caller = this.auth(identity);
    switch (name) {
      case "create_room": {
        const id = randomUUID();
        const members = new Set<string>();
        for (const n of (args.agent_names as string[]) ?? []) {
          const a = [...this.agents.values()].find((x) => x.name === n);
          if (!a) throw new SwitchError(`Unknown agent ${n}`, 400);
          members.add(a.id);
        }
        const room: SimRoom = { id, name: String(args.name), description: String(args.description ?? ""), instructions: String(args.instructions ?? ""), members, timeline: [] };
        this.rooms.set(id, room);
        for (const m of members) {
          const a = this.agents.get(m)!;
          this.record(room, { type: "room_join", payload: { member: this.participantId(a), member_name: a.name, timestamp: Date.now(), listening: false } });
        }
        this.refreshSubscriptions();
        return { id, name: room.name, transport_room_id: `!${id.slice(0, 12)}:${SERVER}`, caller_is_member: members.has(caller.id), failed_attachments: [] } as T;
      }
      case "get_room_detail": {
        const room = this.member(caller, String(args.room_id));
        return { id: room.id, name: room.name, description: room.description, instructions: room.instructions, channel_type: null, created_at: null } as T;
      }
      case "list_participants": {
        const room = this.member(caller, String(args.room_id));
        return [...room.members].map((m) => {
          const a = this.agents.get(m)!;
          return { id: this.participantId(a), name: a.name, type: "agent", status: this.isLive(a.id) ? "online" : "offline", alias: null };
        }) as T;
      }
      case "list_rooms":
        return [...this.rooms.values()].filter((r) => r.members.has(caller.id)).map((r) => ({ room_id: r.id, name: r.name, description: r.description, connected: false, archived: false })) as T;
      case "read_context": {
        const room = this.member(caller, String(args.room_id));
        const limit = Number(args.limit ?? 50);
        const entries = room.timeline.slice(-limit);
        return { threads: entries.map((e) => ({ root: { ...e, attachments: [] }, replies: [] })), truncated: room.timeline.length > limit, oldest_timestamp: entries[0]?.timestamp ?? null } as T;
      }
      case "update_room": {
        const room = this.member(caller, String(args.room_id));
        if (typeof args.instructions === "string") room.instructions = args.instructions;
        return { id: room.id } as T;
      }
      case "invite_agent_to_room": {
        const room = this.member(caller, String(args.room_id));
        const a = [...this.agents.values()].find((x) => x.name === args.agent_name);
        if (!a) throw new SwitchError(`Unknown agent ${String(args.agent_name)}`, 400);
        room.members.add(a.id);
        this.refreshSubscriptions();
        return { ok: true } as T;
      }
      case "archive_room":
        this.member(caller, String(args.room_id));
        return { ok: true } as T;
      default:
        throw new SwitchError(`Unknown operation ${name}`, 404);
    }
  }

  private member(caller: SimAgent, roomId: string): SimRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new SwitchError("Room not found", 404);
    if (!room.members.has(caller.id)) throw new SwitchError("Not a member of this room", 403);
    return room;
  }

  async postMessage(identity: SwitchIdentity, roomId: string, content: string) {
    const sender = this.auth(identity);
    if (this.failNextPosts > 0) {
      this.failNextPosts--;
      throw new SwitchError("Simulated delivery failure", 503);
    }
    const room = this.member(sender, roomId);
    const messageId = `$${randomUUID()}`;
    const payload: Omit<SwitchMessagePayload, "addressed"> = {
      sender: this.participantId(sender),
      sender_name: sender.name,
      message_id: messageId,
      body: content,
      timestamp: Date.now(),
      thread_id: null,
      attachments: [],
    };
    room.timeline.push({ id: messageId, kind: "message", sender: payload.sender, sender_name: sender.name, body: content, timestamp: payload.timestamp });
    for (const m of room.members) {
      const agent = this.agents.get(m)!;
      const addressed = m !== sender.id && mentions(content, agent.name);
      this.deliver(agent, room.id, { type: "message", payload: { ...payload, addressed } });
    }
    return { messageId };
  }

  private record(room: SimRoom, ev: { type: "room_join"; payload: Record<string, unknown> }) {
    room.timeline.push({ id: randomUUID(), kind: "room_join", sender: String(ev.payload.member), sender_name: String(ev.payload.member_name), body: `${String(ev.payload.member_name)} joined the room`, timestamp: Date.now() });
    for (const m of room.members) this.deliver(this.agents.get(m)!, room.id, ev);
  }

  private deliver(agent: SimAgent, roomId: string, ev: { type: DomainEvent["type"]; payload: Record<string, unknown> }) {
    const event: DomainEvent = { type: ev.type, room_id: roomId, bridge_id: null, channel_type: null, payload: ev.payload, sequence: ++agent.seq };
    agent.buffer.push(event);
    if (agent.buffer.length > 2000) agent.buffer.shift();
    for (const c of this.connections) if (c.agentId === agent.id) c.push(event);
  }

  private isLive(agentId: string) {
    return [...this.connections].some((c) => c.agentId === agentId && c.status().state === "open");
  }

  roomsOf(agentId: string) {
    return [...this.rooms.values()].filter((r) => r.members.has(agentId)).map((r) => r.id).sort();
  }

  private refreshSubscriptions() {
    for (const c of this.connections) c.setRooms(this.roomsOf(c.agentId));
  }

  connect(identity: SwitchIdentity, opts: { filter: DeliveryFilter; scope: DeliveryScope }, handlers: ConnectionHandlers): SwitchConnection {
    this.auth(identity);
    const conn = new SimConnection(identity.agentId, opts.filter, handlers, this.roomsOf(identity.agentId), () => this.connections.delete(conn));
    this.connections.add(conn);
    return conn;
  }

  /** Test hook: drop every open stream, as if the bridge restarted. */
  disconnectAll() {
    for (const c of this.connections) c.drop();
  }
}

function mentions(body: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9._-])@${escaped}(?![A-Za-z0-9_-])`, "i").test(body);
}

class SimConnection implements SwitchConnection {
  readonly connectionId = randomUUID();
  private state: ConnectionStatus["state"] = "open";
  private cursor = 0;
  private dropped = false;

  constructor(
    readonly agentId: string,
    private readonly filter: DeliveryFilter,
    private readonly handlers: ConnectionHandlers,
    private rooms: string[],
    private readonly onClose: () => void,
  ) {
    queueMicrotask(() => handlers.onStatus?.(this.status()));
  }

  status(): ConnectionStatus {
    return { state: this.state, rooms: [...this.rooms], cursor: this.cursor, lastHeartbeatAt: Date.now() };
  }

  setRooms(rooms: string[]) {
    this.rooms = rooms;
    this.handlers.onStatus?.(this.status());
  }

  push(ev: DomainEvent) {
    if (this.state !== "open") return;
    if (this.filter === "addressed") {
      const notifiable = ev.type === "message" ? !!(ev.payload as { addressed?: boolean }).addressed : ev.type === "room_join" ? !!(ev.payload as { listening?: boolean }).listening : ev.type !== "command";
      if (!notifiable) return;
    }
    this.cursor = ev.sequence;
    // Deliver asynchronously, like a network hop.
    setImmediate(() => {
      Promise.resolve(this.handlers.onEvent(ev, { gapBefore: false })).catch((e) => console.error("[switch-sim] handler failed", e));
    });
  }

  drop() {
    this.dropped = true;
    this.state = "reconnecting";
    this.handlers.onStatus?.({ ...this.status(), lastError: "simulated disconnect" });
    setTimeout(() => {
      if (this.state === "closed") return;
      this.dropped = false;
      this.state = "open";
      this.handlers.onStatus?.(this.status());
    }, 50);
  }

  get isDropped() {
    return this.dropped;
  }

  async close() {
    this.state = "closed";
    this.onClose();
    this.handlers.onStatus?.(this.status());
  }
}
