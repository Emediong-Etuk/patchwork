"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Plus, Search, Siren } from "lucide-react";
import { api } from "@/src/client/api";
import { useActivity, useIncidents, useSystemStatus } from "@/src/client/hooks";
import { useRepoFilter } from "@/src/client/repo-filter";
import { useWorkspace } from "@/src/client/workspace-context";
import { useEventStream } from "@/src/client/use-event-stream";
import { AGENT_META, AGENT_STATUS_META } from "@/src/client/display";
import { timeAgo } from "@/src/utils/format";
import { PageHeader } from "@/components/layout/app-shell";
import { IncidentTable } from "@/components/incidents/incident-table";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Callout, Skeleton, StatusDot } from "@/components/ui/misc";

type AgentsResponse = { agents: { id: string; name: string; role: string; status: string; currentTask: string | null; lastActiveAt: string | null; tasksCompleted: number; switch: { state: string; mode: string } | null }[] };

function Stat({ label, value, icon, hint }: { label: string; value: number | undefined; icon: React.ReactNode; hint: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-fg-subtle [&_svg]:size-4">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        {icon}
      </div>
      {value === undefined ? <Skeleton className="mt-2 h-7 w-10" /> : <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>}
      <p className="mt-1 text-[11px] text-fg-subtle">{hint}</p>
    </Card>
  );
}

export default function DashboardPage() {
  const { workspaceId } = useWorkspace();
  const { repositoryId } = useRepoFilter();
  const incidents = useIncidents({ repositoryId });
  const activity = useActivity(25);
  const status = useSystemStatus();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<AgentsResponse>("/api/agents"), refetchInterval: 10_000 });
  const stream = useEventStream(workspaceId ? `/api/events?workspaceId=${workspaceId}` : null, { invalidate: [["incidents"], ["activity"], ["agents"]] });

  const list = incidents.data;
  const count = (pred: (s: string) => boolean) => (list ? list.filter((i) => pred(i.status)).length : undefined);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Your engineering command center: incidents, agents and what they are doing right now."
        actions={
          <Button asChild variant="primary">
            <Link href="/incidents/new">
              <Plus /> Report a Bug
            </Link>
          </Button>
        }
      />
      <div className="space-y-5 p-6">
        {status.data && !status.data.ai.available && (
          <Callout tone="warning" title="AI provider not configured">
            {status.data.ai.detail} Incidents can be created, but agents will stop with a clear error instead of producing results.
          </Callout>
        )}
        {status.data && status.data.switch.mode === "simulator" && (
          <Callout tone="info" title="Running on the local Switch simulator">
            Agent messages are routed through PATCHWORK&apos;s in-process simulator of the Switch agent protocol, not a real Switch deployment. Set <code className="font-mono">SWITCH_MODE=live</code> to connect to Switch. <Link className="underline" href="/settings">Details</Link>
          </Callout>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total incidents" value={list?.length} icon={<Siren />} hint="All time, this workspace" />
          <Stat label="Active investigations" value={count((s) => ["TRIAGING", "INVESTIGATING", "FIXING", "TESTING"].includes(s))} icon={<Search />} hint="Agents working now" />
          <Stat label="Awaiting approval" value={count((s) => s === "AWAITING_APPROVAL")} icon={<Clock />} hint="Verified fixes for you to review" />
          <Stat label="Resolved" value={count((s) => s === "RESOLVED")} icon={<CheckCircle2 />} hint="Approved and closed" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader title="Incidents" description={repositoryId ? "Filtered by repository" : "Most recent first"} actions={<Link href="/incidents" className="text-xs text-fg-subtle hover:text-fg">View all</Link>} />
            <IncidentTable incidents={list?.slice(0, 10)} loading={incidents.isLoading} />
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Agents" description="Availability across the workspace" />
              <ul className="divide-y divide-border/60">
                {(agents.data?.agents ?? []).map((a) => {
                  const m = AGENT_STATUS_META[a.status] ?? AGENT_STATUS_META.IDLE;
                  return (
                    <li key={a.id} className="flex items-center gap-2.5 px-4 py-2.5">
                      <AgentAvatar role={a.role} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium">{AGENT_META[a.role]?.name ?? a.name}</p>
                        <p className="truncate text-[11px] text-fg-subtle">{a.currentTask ?? (a.lastActiveAt ? `Last active ${timeAgo(a.lastActiveAt)}` : "No work yet")}</p>
                      </div>
                      <span className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                        <StatusDot tone={m.tone} pulse={m.pulse} /> {m.label}
                      </span>
                    </li>
                  );
                })}
                {agents.isLoading && <li className="p-4"><Skeleton className="h-24" /></li>}
              </ul>
            </Card>
            <Card>
              <CardHeader
                title="Recent activity"
                actions={
                  <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                    <StatusDot tone={stream.state === "live" ? "success" : stream.state === "offline" ? "danger" : "warning"} pulse={stream.state !== "live"} />
                    {stream.state === "live" ? "Live" : stream.state === "offline" ? "Offline" : "Connecting"}
                  </span>
                }
              />
              <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
                <ActivityFeed events={activity.data} loading={activity.isLoading} />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
