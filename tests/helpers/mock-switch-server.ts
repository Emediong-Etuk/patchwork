/**
 * TEST-ONLY mock of a Switch agent bridge, speaking the documented wire
 * protocol over real HTTP + SSE (sandbox-quantum/switch,
 * docs/official/internals/agent-protocol.md). Room semantics come from the
 * simulator; this layer checks paths, auth headers, bodies and framing, and
 * records requests so tests can assert on them.
 */
import http from "http";
import type { AddressInfo } from "net";
import { SimulatedSwitchBackend } from "@/src/lib/switch/simulator";
import type { SwitchIdentity, SwitchConnection } from "@/src/lib/switch/types";

export type MockSwitch = {
  url: string;
  requests: { method: string; path: string; auth: string | null; body: unknown }[];
  opens: { agentId: string; connectionId: string; lastEventId: string | null; scope: string; filter: string }[];
  /** Make the next heartbeat for an agent return this status (404/409 → client must reopen). */
  failNextBeat: (agentId: string, status: number) => void;
  /** Send an `evicted` frame and close the agent's current streams. */
  evict: (agentId: string) => void;
  /** Make the next N calls of an operation fail with HTTP 500. */
  failOp: (name: string, times: number) => void;
  close: () => Promise<void>;
};

export async function startMockSwitch(registrationToken = "test-registration-token"): Promise<MockSwitch> {
  const sim = new SimulatedSwitchBackend();
  const identities = new Map<string, SwitchIdentity>(); // apiKey -> identity
  const requests: MockSwitch["requests"] = [];
  const opens: MockSwitch["opens"] = [];
  const beatFailures = new Map<string, number>();
  const opFailures = new Map<string, number>();
  const streams = new Map<string, { res: http.ServerResponse; conn: SwitchConnection }[]>();

  const readBody = (req: http.IncomingMessage) =>
    new Promise<unknown>((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const auth = req.headers.authorization ?? null;
    const body = req.method === "POST" ? await readBody(req) : null;
    requests.push({ method: req.method ?? "", path: url.pathname, auth, body });
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    if (url.pathname === "/health") return send(res, 200, { status: "ok" });

    if (req.method === "POST" && url.pathname === "/agents") {
      if (bearer !== registrationToken) return send(res, 401, { detail: "invalid registration token" });
      const b = body as { name: string; display_name: string; description: string; connector_type: string; integration_profile: { connection_model: string }; overwrite: boolean };
      if (!/^[a-z0-9][a-z0-9._-]*$/.test(b.name) || !b.integration_profile?.connection_model) return send(res, 400, { detail: "bad registration" });
      try {
        const r = await sim.register({ name: b.name, displayName: b.display_name, description: b.description }, { overwrite: b.overwrite });
        identities.set(r.apiKey, { name: b.name, displayName: b.display_name, description: b.description, agentId: r.id, apiKey: r.apiKey });
        return send(res, 200, { id: r.id, api_key: r.apiKey });
      } catch (e) {
        return send(res, (e as { status?: number }).status ?? 500, { detail: (e as Error).message });
      }
    }

    const m = url.pathname.match(/^\/agents\/([^/]+)\/(.+)$/);
    if (!m) return send(res, 404, { detail: "not found" });
    const [, agentId, rest] = m;
    const identity = bearer ? identities.get(bearer) : undefined;
    // A registration token is rejected everywhere else, as documented.
    if (!identity || identity.agentId !== agentId) return send(res, 401, { detail: "unauthorized" });

    if (req.method === "GET" && rest === "ops") return send(res, 200, { operations: { post_message: { description: "", input_schema: {} } } });

    if (req.method === "GET" && rest === "events") {
      const connectionId = url.searchParams.get("connection_id");
      if (!connectionId) return send(res, 400, { detail: "connection_id required" });
      if (req.headers.accept !== "text/event-stream") return send(res, 400, { detail: "Accept must be text/event-stream" });
      opens.push({ agentId, connectionId, lastEventId: (req.headers["last-event-id"] as string) ?? null, scope: url.searchParams.get("scope") ?? "", filter: url.searchParams.get("filter") ?? "" });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const filter = (url.searchParams.get("filter") ?? "all") as "all" | "addressed";
      const conn = sim.connect(identity, { filter, scope: "all" }, {
        onEvent: (ev) => {
          res.write(`id: ${ev.sequence}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
        },
      });
      res.write(`event: connection_state\ndata: ${JSON.stringify({ connection_id: connectionId, agent_id: agentId, scope: "all", filter, rooms: sim.roomsOf(agentId), cursor: 0, heartbeat_interval_seconds: 1 })}\n\n`);
      const list = streams.get(agentId) ?? [];
      list.push({ res, conn });
      streams.set(agentId, list);
      req.on("close", () => {
        void conn.close();
        streams.set(agentId, (streams.get(agentId) ?? []).filter((s) => s.res !== res));
      });
      return;
    }

    if (req.method === "POST" && rest === "connection/beat") {
      const b = body as { connection_id?: string; cursor?: number };
      if (!b?.connection_id || typeof b.cursor !== "number") return send(res, 400, { detail: "connection_id and cursor required" });
      const fail = beatFailures.get(agentId);
      if (fail) {
        beatFailures.delete(agentId);
        return send(res, fail, { detail: "unknown connection" });
      }
      return send(res, 200, { ok: true, rooms: sim.roomsOf(agentId), cursor: b.cursor });
    }

    if (req.method === "POST" && rest === "message") {
      const b = body as { room_id: string; content: string };
      try {
        const r = await sim.postMessage(identity, b.room_id, b.content);
        return send(res, 200, { message_id: r.messageId });
      } catch (e) {
        return send(res, (e as { status?: number }).status ?? 500, { detail: (e as Error).message });
      }
    }

    const op = rest.match(/^ops\/([a-z_]+)$/);
    if (req.method === "POST" && op) {
      const left = opFailures.get(op[1]) ?? 0;
      if (left > 0) {
        opFailures.set(op[1], left - 1);
        return send(res, 500, { detail: "injected failure" });
      }
      try {
        return send(res, 200, { result: await sim.op(identity, op[1], (body ?? {}) as Record<string, unknown>) });
      } catch (e) {
        return send(res, (e as { status?: number }).status ?? 500, { detail: (e as Error).message });
      }
    }
    return send(res, 404, { detail: "not found" });
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    opens,
    failNextBeat: (agentId, status) => beatFailures.set(agentId, status),
    failOp: (name, times) => opFailures.set(name, times),
    evict: (agentId) => {
      for (const s of streams.get(agentId) ?? []) {
        s.res.write(`event: evicted\ndata: ${JSON.stringify({ reason: "test eviction" })}\n\n`);
        s.res.end();
      }
    },
    close: () =>
      new Promise((r) => {
        for (const list of streams.values()) for (const s of list) s.res.end();
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}
