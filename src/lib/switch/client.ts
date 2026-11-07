/**
 * Live Switch client. Implements the documented agent protocol:
 *
 *   Registration   POST /agents                         (registration token)
 *   Verify         GET  /agents/{id}/ops                (agent API key)
 *   Event stream   GET  /agents/{id}/events?connection_id=...&scope=...&filter=...   (SSE)
 *   Heartbeat      POST /agents/{id}/connection/beat    every heartbeat_interval_seconds (2s)
 *   Operations     POST /agents/{id}/ops/{name}         (arguments unwrapped in the body)
 *   Post message   POST /agents/{id}/message            {room_id, content}
 *
 * Source: sandbox-quantum/switch docs/official/internals/agent-protocol.md
 */
import { randomUUID } from "crypto";
import { createParser } from "eventsource-parser";
import {
  SwitchError,
  type AgentRegistration,
  type ConnectionHandlers,
  type ConnectionStateFrame,
  type ConnectionStatus,
  type DeliveryFilter,
  type DeliveryScope,
  type DomainEvent,
  type SwitchBackend,
  type SwitchConnection,
  type SwitchIdentity,
} from "./types";

const DOMAIN_EVENTS = new Set(["message", "command", "room_join", "task_delegate", "task_accept", "task_update", "task_finalise", "task_cancel"]);
const CLIENT_NAME = "patchwork";
const CLIENT_VERSION = "0.1.0";

type FetchLike = typeof fetch;

export class HttpSwitchBackend implements SwitchBackend {
  readonly mode = "live" as const;
  readonly label: string;

  constructor(
    private readonly baseUrl: string,
    private readonly registrationToken: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.label = `Switch bridge at ${this.baseUrl}`;
  }

  url(path: string) {
    return `${this.baseUrl}${path}`;
  }

  async health() {
    try {
      const res = await this.fetchImpl(this.url("/health"), { signal: AbortSignal.timeout(5000) });
      if (res.ok) return { ok: true, detail: "Switch bridge reachable" };
      if (res.status === 401) return { ok: false, detail: "Host reachable but this is not the agent bridge base URL (401 on /health)" };
      return { ok: false, detail: `Switch /health returned HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: `Cannot reach Switch at ${this.baseUrl}: ${(e as Error).message}` };
    }
  }

  async register(reg: AgentRegistration, opts: { overwrite: boolean }) {
    if (!this.registrationToken) throw new SwitchError("SWITCH_REGISTRATION_TOKEN is not set; cannot register PATCHWORK agents with Switch");
    const res = await this.fetchImpl(this.url("/agents"), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.registrationToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: reg.name,
        description: reg.description,
        display_name: reg.displayName,
        connector_type: "custom",
        integration_profile: {
          // PATCHWORK keeps a stream open for every agent while it runs.
          connection_model: "always_on",
          message_exchange: true,
          pre_invocation_mediation: [],
          post_invocation_mediation: [],
          event_reporting: [],
        },
        metadata: { application: "patchwork" },
        overwrite: opts.overwrite,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await readBody(res);
    if (!res.ok) throw new SwitchError(`Switch agent registration for "${reg.name}" failed with HTTP ${res.status}`, res.status, body);
    const { id, api_key } = body as { id?: string; api_key?: string };
    if (!id || !api_key) throw new SwitchError("Switch registration response did not include id and api_key", res.status, body);
    return { id, apiKey: api_key };
  }

  async verify(identity: SwitchIdentity) {
    const res = await this.fetchImpl(this.url(`/agents/${identity.agentId}/ops`), {
      headers: { Authorization: `Bearer ${identity.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  }

  async op<T>(identity: SwitchIdentity, name: string, args: Record<string, unknown>, connectionId?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${identity.apiKey}`, "Content-Type": "application/json" };
    if (connectionId) headers["X-Switch-Connection-Id"] = connectionId;
    const res = await this.fetchImpl(this.url(`/agents/${identity.agentId}/ops/${name}`), {
      method: "POST",
      headers,
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30000),
    });
    const body = await readBody(res);
    if (!res.ok) throw new SwitchError(`Switch operation ${name} failed with HTTP ${res.status}`, res.status, body);
    return (body as { result: T }).result;
  }

  async postMessage(identity: SwitchIdentity, roomId: string, content: string) {
    const res = await this.fetchImpl(this.url(`/agents/${identity.agentId}/message`), {
      method: "POST",
      headers: { Authorization: `Bearer ${identity.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ room_id: roomId, content }),
      signal: AbortSignal.timeout(30000),
    });
    const body = (await readBody(res)) as Record<string, unknown> | null;
    if (!res.ok) throw new SwitchError(`Switch message delivery failed with HTTP ${res.status}`, res.status, body);
    const id = body && (body.message_id ?? body.event_id ?? body.id);
    return { messageId: typeof id === "string" ? id : null };
  }

  connect(identity: SwitchIdentity, opts: { filter: DeliveryFilter; scope: DeliveryScope; rooms?: string[] }, handlers: ConnectionHandlers): SwitchConnection {
    return new HttpSwitchConnection(this, this.fetchImpl, identity, opts, handlers);
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * One agent connection. The client owns the connection id and reuses it on
 * every reopen (the connection outlives its socket). Heartbeats carry the
 * cursor; a 404/409 on the beat means "reopen the stream", not "back off".
 */
class HttpSwitchConnection implements SwitchConnection {
  readonly connectionId = randomUUID();
  private cursor: number | null = null;
  private rooms: string[] = [];
  private state: ConnectionStatus["state"] = "connecting";
  private lastError: string | undefined;
  private lastHeartbeatAt: number | undefined;
  private heartbeatMs = 2000;
  private closed = false;
  private abort: AbortController | null = null;
  private beatTimer: NodeJS.Timeout | null = null;
  private pendingGap = false;
  private backoffMs = 1000;
  private seen = new Set<number>();

  constructor(
    private readonly backend: HttpSwitchBackend,
    private readonly fetchImpl: FetchLike,
    private readonly identity: SwitchIdentity,
    private readonly opts: { filter: DeliveryFilter; scope: DeliveryScope; rooms?: string[] },
    private readonly handlers: ConnectionHandlers,
  ) {
    void this.loop();
  }

  status(): ConnectionStatus {
    return { state: this.state, rooms: [...this.rooms], cursor: this.cursor, lastError: this.lastError, lastHeartbeatAt: this.lastHeartbeatAt };
  }

  async close() {
    this.closed = true;
    this.stopBeat();
    this.abort?.abort();
    this.setState("closed");
  }

  private setState(state: ConnectionStatus["state"], err?: string) {
    this.state = state;
    if (err !== undefined) this.lastError = err;
    this.handlers.onStatus?.(this.status());
  }

  private async loop() {
    while (!this.closed) {
      try {
        await this.openOnce();
        this.backoffMs = 1000;
      } catch (e) {
        if (this.closed) break;
        this.setState("reconnecting", (e as Error).message);
      }
      this.stopBeat();
      if (this.closed) break;
      if (this.state !== "reconnecting") this.setState("reconnecting");
      await sleep(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 1.5, 30_000);
    }
  }

  private async openOnce() {
    const params = new URLSearchParams({
      connection_id: this.connectionId,
      scope: this.opts.scope,
      filter: this.opts.filter,
      start_from: "head",
      client: CLIENT_NAME,
      client_version: CLIENT_VERSION,
    });
    // Declare rooms on the open URL, not after, so catch-up covers them.
    if (this.opts.rooms?.length) params.set("rooms", this.opts.rooms.join(","));
    const headers: Record<string, string> = { Authorization: `Bearer ${this.identity.apiKey}`, Accept: "text/event-stream" };
    if (this.cursor !== null) headers["Last-Event-ID"] = String(this.cursor);
    this.abort = new AbortController();
    const res = await this.fetchImpl(this.backend.url(`/agents/${this.identity.agentId}/events?${params}`), { headers, signal: this.abort.signal });
    if (!res.ok || !res.body) {
      const body = await readBody(res).catch(() => null);
      throw new SwitchError(`Switch event stream refused with HTTP ${res.status}`, res.status, body);
    }

    let evicted = false;
    const parser = createParser({
      onEvent: (msg) => {
        const kind = msg.event ?? "message";
        let data: unknown;
        try {
          data = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (kind === "connection_state") {
          const s = data as ConnectionStateFrame;
          // Read it rather than assuming: rooms and cursor are the server's answer.
          this.rooms = s.rooms ?? [];
          if (typeof s.cursor === "number") this.cursor = Math.max(this.cursor ?? 0, s.cursor);
          if (s.heartbeat_interval_seconds) this.heartbeatMs = s.heartbeat_interval_seconds * 1000;
          this.setState("open", "");
          this.startBeat();
          return;
        }
        if (kind === "gap") {
          // Not a wake: attach to the next event we surface.
          this.pendingGap = true;
          return;
        }
        if (kind === "subscription_changed") {
          this.rooms = (data as { rooms?: string[] }).rooms ?? this.rooms;
          this.handlers.onStatus?.(this.status());
          return;
        }
        if (kind === "evicted") {
          evicted = true;
          this.lastError = `evicted: ${(data as { reason?: string }).reason ?? "unknown"}`;
          this.abort?.abort();
          return;
        }
        if (kind === "room_released") return;
        if (DOMAIN_EVENTS.has(kind)) {
          const ev = data as DomainEvent;
          const seq = typeof ev.sequence === "number" ? ev.sequence : msg.id ? Number(msg.id) : NaN;
          if (Number.isFinite(seq)) {
            if (this.seen.has(seq)) return; // duplicate delivery after a reconnect
            this.seen.add(seq);
            if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
            this.cursor = Math.max(this.cursor ?? 0, seq);
          }
          const gapBefore = this.pendingGap;
          this.pendingGap = false;
          Promise.resolve(this.handlers.onEvent(ev, { gapBefore })).catch((e) => console.error("[switch] event handler failed", e));
        }
      },
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (!this.closed && !evicted) throw e;
    }
    if (!this.closed) this.setState("reconnecting", evicted ? this.lastError : "event stream ended");
  }

  private startBeat() {
    this.stopBeat();
    const beat = async () => {
      if (this.closed) return;
      try {
        const res = await this.fetchImpl(this.backend.url(`/agents/${this.identity.agentId}/connection/beat`), {
          method: "POST",
          headers: { Authorization: `Bearer ${this.identity.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ connection_id: this.connectionId, cursor: this.cursor ?? 0 }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 404 || res.status === 409) {
          // Unknown/dead connection or no stream attached: reopen, never retry the beat.
          this.lastError = `heartbeat ${res.status}: reopening stream`;
          this.abort?.abort();
          return;
        }
        if (res.ok) {
          this.lastHeartbeatAt = Date.now();
          const body = (await readBody(res)) as { rooms?: string[]; cursor?: number } | null;
          if (body?.rooms) this.rooms = body.rooms;
        }
      } catch (e) {
        this.lastError = `heartbeat failed: ${(e as Error).message}`;
      }
    };
    this.beatTimer = setInterval(beat, this.heartbeatMs);
    void beat();
  }

  private stopBeat() {
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.beatTimer = null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
