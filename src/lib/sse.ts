import { db } from "@/src/lib/database/client";
import { subscribe, toStreamEvent } from "@/src/lib/events/bus";
import type { StreamEvent } from "@/src/lib/events/types";

/**
 * Server-Sent Events with resume: the client sends Last-Event-ID (the event
 * sequence) and receives everything after it from the database before live
 * events, so reconnects never lose or duplicate events (clients dedupe by seq).
 */
export function eventStream(req: Request, filter: { incidentId?: string; workspaceId?: string }) {
  const url = new URL(req.url);
  const lastId = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  const after = lastId && /^\d+$/.test(lastId) ? BigInt(lastId) : null;
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let lastSent = after ?? 0n;
      let closed = false;
      const send = (e: StreamEvent) => {
        if (closed) return;
        const seq = BigInt(e.seq);
        if (seq <= lastSent) return;
        lastSent = seq;
        controller.enqueue(encoder.encode(`id: ${e.seq}\nevent: activity\ndata: ${JSON.stringify(e)}\n\n`));
      };
      const matches = (e: StreamEvent) => (filter.incidentId ? e.incidentId === filter.incidentId : filter.workspaceId ? e.workspaceId === filter.workspaceId : false);
      // Buffer live events while replaying, then flush in order.
      const buffered: StreamEvent[] = [];
      let replaying = true;
      const unsub = subscribe((e) => {
        if (!matches(e)) return;
        if (replaying) buffered.push(e);
        else send(e);
      });
      const ping = setInterval(() => !closed && controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`)), 15_000);
      cleanup = () => {
        closed = true;
        clearInterval(ping);
        unsub();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      controller.enqueue(encoder.encode(`retry: 2000\n: connected\n\n`));
      const where = filter.incidentId ? { incidentId: filter.incidentId } : { workspaceId: filter.workspaceId };
      const missed = await db.activityEvent.findMany({ where: { ...where, ...(after !== null ? { seq: { gt: after } } : {}) }, orderBy: { seq: after !== null ? "asc" : "desc" }, take: after !== null ? 1000 : 50 });
      const ordered = after !== null ? missed : missed.reverse();
      for (const row of ordered) send(toStreamEvent(row));
      replaying = false;
      buffered.sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1)).forEach(send);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
