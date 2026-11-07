"use client";
import Link from "next/link";
import { Activity } from "lucide-react";
import type { ActivityRow } from "@/src/client/hooks";
import { ROLE_BY_AGENT_ID } from "@/src/client/display";
import { timeAgo } from "@/src/utils/format";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { EmptyState, Skeleton } from "@/components/ui/misc";

export function ActivityFeed({ events, loading, showIncident = true }: { events: ActivityRow[] | undefined; loading?: boolean; showIncident?: boolean }) {
  if (loading) return <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>;
  if (!events?.length) return <EmptyState icon={<Activity />} title="No activity yet" description="Agent handoffs, test runs and approvals stream in here as they happen." />;
  return (
    <ul className="divide-y divide-border/60">
      {events.map((e) => {
        const role = e.actorId ? ROLE_BY_AGENT_ID[e.actorId] : null;
        return (
          <li key={e.id} className="flex gap-2.5 px-4 py-2.5">
            <AgentAvatar role={role} size="sm" human={e.actorType === "USER"} system={e.actorType === "SYSTEM"} />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-fg-muted">
                {showIncident && e.incident && (
                  <Link href={`/incidents/${e.incidentId}`} className="mr-1 font-mono text-fg-subtle hover:text-fg">
                    INC-{e.incident.number}
                  </Link>
                )}
                {e.description}
              </p>
              <p className="mt-0.5 text-[11px] text-fg-subtle">
                {e.eventType.replaceAll("_", " ").toLowerCase()} · {timeAgo(e.createdAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
