"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useWorkspace } from "./workspace-context";

export type StatusResponse = {
  switch: { mode: "live" | "simulator"; label: string; connected: boolean; detail: string; bridgeUrl: string | null; identities: { key: string; name: string; displayName: string; agentId: string; state: string; rooms: number; lastError: string | null }[] };
  ai: { provider: string; available: boolean; detail: string; models: Record<string, string> };
  github: { oauthConfigured: boolean };
  execution: { mode: string; timeoutMs: number; maxFixAttempts: number };
  runtimeError: string | null;
};

export function useSystemStatus() {
  return useQuery({ queryKey: ["status"], queryFn: () => api<StatusResponse>("/api/status"), refetchInterval: 10_000 });
}

export type RepositoryRow = { id: string; provider: "GITHUB" | "LOCAL"; owner: string; name: string; fullName: string; defaultBranch: string; visibility: string; description: string | null; htmlUrl: string | null; connectionStatus: string; activeIncidents: number; createdAt: string; _count: { incidents: number } };

export function useRepositories() {
  const { workspaceId } = useWorkspace();
  return useQuery({ queryKey: ["repositories", workspaceId], enabled: !!workspaceId, queryFn: () => api<{ repositories: RepositoryRow[] }>(`/api/repositories?workspaceId=${workspaceId}`).then((r) => r.repositories) });
}

export type IncidentRow = { id: string; number: number; title: string; status: string; severity: string | null; createdAt: string; updatedAt: string; repositoryId: string; repository: { fullName: string; provider: string }; tasks: { agentId: string; title: string }[]; switchMode: string | null };

export function useIncidents(filter: { repositoryId?: string | null } = {}) {
  const { workspaceId } = useWorkspace();
  const qs = new URLSearchParams({ workspaceId: workspaceId ?? "" });
  if (filter.repositoryId) qs.set("repositoryId", filter.repositoryId);
  return useQuery({ queryKey: ["incidents", workspaceId, filter.repositoryId ?? null], enabled: !!workspaceId, queryFn: () => api<{ incidents: IncidentRow[] }>(`/api/incidents?${qs}`).then((r) => r.incidents), refetchInterval: 15_000 });
}

export type ActivityRow = { seq: string; id: string; incidentId: string | null; eventType: string; description: string; actorType: string; actorId: string | null; createdAt: string; metadata: Record<string, unknown>; incident: { number: number; title: string } | null };

export function useActivity(limit = 50, types?: string[]) {
  const { workspaceId } = useWorkspace();
  return useQuery({ queryKey: ["activity", workspaceId, limit, types?.join(",") ?? ""], enabled: !!workspaceId, queryFn: () => api<{ events: ActivityRow[] }>(`/api/activity?workspaceId=${workspaceId}&limit=${limit}${types ? `&types=${types.join(",")}` : ""}`).then((r) => r.events) });
}
