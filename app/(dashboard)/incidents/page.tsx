"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useIncidents } from "@/src/client/hooks";
import { useRepoFilter } from "@/src/client/repo-filter";
import { STATUS_META } from "@/src/client/display";
import { PageHeader } from "@/components/layout/app-shell";
import { IncidentTable } from "@/components/incidents/incident-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/src/utils/cn";

const FILTERS = [
  { key: "all", label: "All", match: () => true },
  { key: "active", label: "Active", match: (s: string) => !!STATUS_META[s]?.active },
  { key: "approval", label: "Awaiting approval", match: (s: string) => s === "AWAITING_APPROVAL" },
  { key: "attention", label: "Needs attention", match: (s: string) => ["BLOCKED", "FAILED", "NEEDS_INFORMATION", "REJECTED"].includes(s) },
  { key: "done", label: "Resolved", match: (s: string) => ["RESOLVED", "CANCELLED"].includes(s) },
];

export default function IncidentsPage() {
  const { repositoryId } = useRepoFilter();
  const { data, isLoading } = useIncidents({ repositoryId });
  const [filter, setFilter] = useState("all");
  const f = FILTERS.find((x) => x.key === filter)!;
  const rows = data?.filter((i) => f.match(i.status));
  return (
    <div>
      <PageHeader
        title="Incidents"
        description="Every bug report and where it stands."
        actions={
          <Button asChild variant="primary">
            <Link href="/incidents/new">
              <Plus /> Report a Bug
            </Link>
          </Button>
        }
      />
      <div className="p-6">
        <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Filter incidents">
          {FILTERS.map((x) => (
            <button key={x.key} role="tab" aria-selected={filter === x.key} onClick={() => setFilter(x.key)} className={cn("rounded-md px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg", filter === x.key && "bg-surface-3 text-fg")}>
              {x.label}
              {data && <span className="ml-1.5 text-fg-subtle">{data.filter((i) => x.match(i.status)).length}</span>}
            </button>
          ))}
        </div>
        <Card>
          <IncidentTable incidents={rows} loading={isLoading} />
        </Card>
      </div>
    </div>
  );
}
