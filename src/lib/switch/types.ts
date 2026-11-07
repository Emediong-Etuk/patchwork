/**
 * Types for the Switch agent protocol (SSE down, HTTP up), as documented in
 * sandbox-quantum/switch: docs/official/internals/agent-protocol.md
 * (published at https://docs.switchagents.ai/flintai/switch/internals/agent-protocol).
 *
 * Only the fields PATCHWORK reads are typed; everything else passes through.
 */

export type SwitchMode = "live" | "simulator";

/** A registered Switch agent identity that PATCHWORK acts as. */
export type SwitchIdentity = {
  /** Registry name, e.g. "patchwork-investigator". Matches ^[a-z0-9][a-z0-9._-]*$ */
  name: string;
  displayName: string;
  description: string;
  /** Switch agent id returned by registration. */
  agentId: string;
  /** Agent API key returned once by registration. Never logged, never sent to the browser. */
  apiKey: string;
};

export type AgentRegistration = {
  name: string;
  displayName: string;
  description: string;
};

export type DeliveryFilter = "all" | "addressed";
export type DeliveryScope = "single" | "all";

/** Payload of a `message` domain event. */
export type SwitchMessagePayload = {
  addressed: boolean;
  sender: string;
  sender_name: string;
  sender_kind?: string;
  on_behalf_of?: string;
  message_id: string;
  body: string;
  timestamp: number;
  thread_id: string | null;
  attachments: unknown[];
};

export type SwitchRoomJoinPayload = {
  member: string;
  member_name: string;
  timestamp: number;
  listening: boolean;
};

export type DomainEventType =
  | "message"
  | "command"
  | "room_join"
  | "task_delegate"
  | "task_accept"
  | "task_update"
  | "task_finalise"
  | "task_cancel";

export type DomainEvent<P = Record<string, unknown>> = {
  type: DomainEventType;
  room_id: string;
  bridge_id: string | null;
  channel_type: string | null;
  payload: P;
  sequence: number;
};

export type ConnectionStateFrame = {
  connection_id: string;
  agent_id: string;
  scope: DeliveryScope;
  filter: DeliveryFilter;
  rooms: string[];
  cursor: number;
  protocol?: unknown;
  heartbeat_interval_seconds?: number;
};

export type ControlFrame =
  | { kind: "connection_state"; data: ConnectionStateFrame }
  | { kind: "gap"; data: { from_sequence: number; resumed_at: number; reason: string } }
  | { kind: "evicted"; data: { reason: string } }
  | { kind: "subscription_changed"; data: { rooms: string[]; reason: string } }
  | { kind: "room_released"; data: { room_id: string; session_id: string | null } };

/** What a connection reports to its owner. */
export type ConnectionHandlers = {
  onEvent: (event: DomainEvent, meta: { gapBefore: boolean }) => void | Promise<void>;
  onStatus?: (status: ConnectionStatus) => void;
};

export type ConnectionStatus = {
  state: "connecting" | "open" | "reconnecting" | "closed";
  rooms: string[];
  cursor: number | null;
  lastError?: string;
  lastHeartbeatAt?: number;
};

export interface SwitchConnection {
  readonly connectionId: string;
  status(): ConnectionStatus;
  close(): Promise<void>;
}

export type CreateRoomInput = {
  name: string;
  description: string;
  agentNames: string[];
  instructions: string;
  internalOnly: boolean;
  userNames?: string[];
};

export type CreatedRoom = { id: string; name: string; transportRoomId?: string | null; callerIsMember?: boolean };

export type ContextEntry = { id: string; kind: string; sender: string; sender_name: string; body: string; timestamp: number };

export type RoomContext = { threads: { root: ContextEntry; replies: ContextEntry[] }[]; truncated: boolean };

/**
 * Everything PATCHWORK needs from a Switch deployment. Implemented by the live
 * HTTP client and by the clearly-labelled local simulator.
 */
export interface SwitchBackend {
  readonly mode: SwitchMode;
  readonly label: string;
  health(): Promise<{ ok: boolean; detail: string }>;
  /** Register an agent; returns its id and (once-only) API key. */
  register(reg: AgentRegistration, opts: { overwrite: boolean }): Promise<{ id: string; apiKey: string }>;
  /** Check stored credentials still work. */
  verify(identity: SwitchIdentity): Promise<boolean>;
  /** Open the agent's event stream. */
  connect(identity: SwitchIdentity, opts: { filter: DeliveryFilter; scope: DeliveryScope; rooms?: string[] }, handlers: ConnectionHandlers): SwitchConnection;
  /** Invoke a named operation (POST /agents/{id}/ops/{name}). */
  op<T = unknown>(identity: SwitchIdentity, name: string, args: Record<string, unknown>): Promise<T>;
  /** Post into a room without needing a connection (POST /agents/{id}/message). */
  postMessage(identity: SwitchIdentity, roomId: string, content: string): Promise<{ messageId: string | null }>;
}

export class SwitchError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "SwitchError";
  }
}
