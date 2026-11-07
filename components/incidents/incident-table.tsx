"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Siren } from "lucide-react";
import type { IncidentRow } from "@/src/client/hooks";
import { AGENT_META, ROLE_BY_AGENT_ID } from "@/src/client/display";
import { dateTime } from "@/src/utils/format";
import { StatusBadge, SeverityBadge } from "./badges";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";

export function IncidentTable({ incidents, loading, compact }: { incidents: IncidentRow[] | undefined; loading?: boolean; compact?: boolean }) {
  const router = useRouter();
  if (loading)
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  if (!incidents?.length)
    return (
      <EmptyState
        icon={<Siren />}
        title="No incidents yet"
        description="Report a bug and the agents will triage it, investigate the repository, propose a fix and test it. The bundled demo repository has a real bug to try."
        action={
          <Button asChild variant="primary" size="sm">
            <Link href="/incidents/new">Report a Bug</Link>
          </Button>
        }
      />
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-fg-subtle">
            <th className="px-4 py-2 font-medium">Incident</th>
            {!compact && <th className="px-4 py-2 font-medium">Repository</th>}
            <th className="px-4 py-2 font-medium">Severity</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Active agent</th>
            <th className="px-4 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => {
            const active = i.tasks[0] ? ROLE_BY_AGENT_ID[i.tasks[0].agentId] : null;
            return (
              <tr key={i.id} onClick={() => router.push(`/incidents/${i.id}`)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2">
                <td className="max-w-[340px] px-4 py-2.5">
                  <Link href={`/incidents/${i.id}`} className="flex items-center gap-2 focus:outline-none" onClick={(e) => e.stopPropagation()}>
                    <span className="font-mono text-xs text-fg-subtle">INC-{i.number}</span>
                    <span className="truncate font-medium text-fg">{i.title}</span>
                  </Link>
                </td>
                {!compact && <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">{i.repository.fullName}</td>}
                <td className="px-4 py-2.5"><SeverityBadge severity={i.severity} /></td>
                <td className="px-4 py-2.5"><StatusBadge status={i.status} /></td>
                <td className="px-4 py-2.5">
                  {active ? (
                    <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <AgentAvatar role={active} size="sm" /> {AGENT_META[active].short}
                    </span>
                  ) : (
                    <span className="text-xs text-fg-subtle">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-fg-subtle">{dateTime(i.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
