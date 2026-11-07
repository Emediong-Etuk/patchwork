"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { StreamEvent } from "@/src/lib/events/types";

export type StreamState = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Subscribes to a PATCHWORK SSE stream. EventSource resends Last-Event-ID on
 * reconnect, the server replays what was missed, and events are deduplicated
 * and ordered by their sequence number here, so drops, duplicates and
 * out-of-order delivery all converge to the same list.
 */
export function useEventStream(url: string | null, opts: { invalidate?: unknown[][]; initial?: StreamEvent[] } = {}) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [state, setState] = useState<StreamState>("connecting");
  const seen = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateRef = useRef(opts.invalidate);
  invalidateRef.current = opts.invalidate;

  useEffect(() => {
    if (opts.initial?.length) merge(opts.initial);
  }, [opts.initial]);

  function merge(incoming: StreamEvent[]) {
    const fresh = incoming.filter((e) => !seen.current.has(e.seq));
    if (!fresh.length) return;
    fresh.forEach((e) => seen.current.add(e.seq));
    setEvents((prev) => [...prev, ...fresh].sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1)).slice(-500));
  }

  useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const open = () => {
      const last = [...seen.current].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).pop();
      es = new EventSource(last ? `${url}${url.includes("?") ? "&" : "?"}after=${last}` : url);
      es.onopen = () => {
        failures = 0;
        setState("live");
      };
      es.addEventListener("activity", (msg) => {
        try {
          merge([JSON.parse((msg as MessageEvent).data) as StreamEvent]);
        } catch {
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => invalidateRef.current?.forEach((k) => qc.invalidateQueries({ queryKey: k })), 250);
      });
      es.onerror = () => {
        failures++;
        if (es?.readyState === EventSource.CLOSED) {
          // Browser gave up (e.g. 401/500); retry ourselves with backoff.
          es.close();
          setState(failures > 5 ? "offline" : "reconnecting");
          if (!closed) retryTimer = setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
        } else setState("reconnecting");
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [url, qc]);

  return { events, state };
}
