"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { IncidentDetail } from "./incident-types";
import { useEventStream } from "./use-event-stream";

export function useIncident(id: string) {
  const query = useQuery({ queryKey: ["incident", id], queryFn: () => api<IncidentDetail>(`/api/incidents/${id}`), refetchInterval: (q) => (q.state.data && ["RESOLVED", "CANCELLED"].includes(q.state.data.incident.status) ? false : 20_000) });
  const stream = useEventStream(`/api/incidents/${id}/events`, { invalidate: [["incident", id]], initial: query.data?.events });
  return { ...query, stream };
}
