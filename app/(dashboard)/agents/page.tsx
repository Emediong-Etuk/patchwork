"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/src/client/api";
import { AGENT_META, AGENT_STATUS_META } from "@/src/client/display";
import { timeAgo } from "@/src/utils/format";
import { PageHeader } from "@/components/layout/app-shell";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton, StatusDot } from "@/components/ui/misc";

type AgentItem = {
  id: string; name: string; role: string; title: string; description: string; model: string; provider: string; status: string; currentTask: string | null; lastActiveAt: string | null; tasksCompleted: number; tasksFailed: number;
  configuration: { tools?: string[]; capabilities?: string[]; effort?: string };
  recent: { id: string; title: string; status: string; stage: string; attempt: number; createdAt: string; incident: { id: string; number: number; title: string } }[];
  switch: { name: string; agentId: string; state: string; mode: string } | null;
};

function AgentDrawer({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["agent", id], queryFn: () => api<{ instructions: string; tasks: AgentItem["recent"] }>(`/api/agents/${id}`) });
  if (!data) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">System instructions</p>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-[11.5px] leading-5 text-fg-muted scrollbar-thin">{data.instructions}</pre>
      </div>
      <div>
        <p className="mb-1 text-[11px] uppercase tracking-wide text-fg-subtle">Task history</p>
        <ul className="space-y-1.5">
          {data.tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-xs">
              <Badge tone={t.status === "COMPLETED" ? "success" : t.status === "FAILED" ? "danger" : t.status === "RUNNING" ? "accent" : "neutral"}>{t.status.toLowerCase()}</Badge>
              <Link href={`/incidents/${t.incident.id}`} className="truncate text-fg-muted hover:text-fg">INC-{t.incident.number} · {t.title}</Link>
              <span className="ml-auto shrink-0 text-fg-subtle">{timeAgo(t.createdAt)}</span>
            </li>
          ))}
          {!data.tasks.length && <li className="text-xs text-fg-subtle">No tasks yet.</li>}
        </ul>
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["agents"], queryFn: () => api<{ agents: AgentItem[] }>("/api/agents"), refetchInterval: 10_000 });
  const [open, setOpen] = useState<AgentItem | null>(null);
  return (
    <div>
      <PageHeader title="Agents" description="Four specialists with separate identities, instructions, tools and models. Each one is its own Switch agent." />
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        {data?.agents.map((a) => {
          const m = AGENT_META[a.role];
          const s = AGENT_STATUS_META[a.status] ?? AGENT_STATUS_META.IDLE;
          return (
            <Card key={a.id} className="flex flex-col">
              <button type="button" onClick={() => setOpen(a)} className="flex flex-1 flex-col p-5 text-left hover:bg-surface-2/50">
                <div className="flex items-start gap-3">
                  <AgentAvatar role={a.role} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{m.name}</p>
                      <span className="flex items-center gap-1.5 text-xs text-fg-muted"><StatusDot tone={s.tone} pulse={s.pulse} /> {s.label}</span>
                    </div>
                    <p className="text-xs capitalize text-fg-subtle">{a.title}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-fg-muted">{a.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {a.configuration.capabilities?.map((c) => <Badge key={c}>{c}</Badge>)}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs">
                  <div><dt className="text-fg-subtle">Completed tasks</dt><dd className="mt-0.5 text-base font-semibold tabular-nums">{a.tasksCompleted}</dd></div>
                  <div><dt className="text-fg-subtle">Model</dt><dd className="mt-0.5 font-mono text-fg-muted">{a.model}</dd></div>
                  <div><dt className="text-fg-subtle">Switch identity</dt><dd className="mt-0.5 truncate font-mono text-fg-muted" title={a.switch?.agentId}>{a.switch?.name ?? "—"}</dd></div>
                </dl>
                <p className="mt-2 text-[11px] text-fg-subtle">Tools: <span className="font-mono">{a.configuration.tools?.join(", ")}</span></p>
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-fg-subtle">Recent activity</p>
                  {a.recent.length ? (
                    <ul className="space-y-1">
                      {a.recent.slice(0, 3).map((t) => (
                        <li key={t.id} className="flex items-center gap-2 text-xs text-fg-muted">
                          <StatusDot tone={t.status === "COMPLETED" ? "success" : t.status === "FAILED" ? "danger" : "accent"} />
                          <span className="truncate">INC-{t.incident.number} · {t.title}</span>
                          <span className="ml-auto shrink-0 text-fg-subtle">{timeAgo(t.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-fg-subtle">No work yet.</p>
                  )}
                </div>
              </button>
            </Card>
          );
        })}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent side="right" title={AGENT_META[open.role].name} description={`${open.title} · ${open.provider} ${open.model} · effort ${open.configuration.effort ?? "default"}`}>
            <AgentDrawer id={open.id} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
