"use client";
import { use } from "react";
import { useIncident } from "@/src/client/use-incident";
import { ApiError } from "@/src/client/api";
import { IncidentHeader } from "@/components/incidents/incident-header";
import { CodeChangesCard, FindingsCard, QACard, ReportCard } from "@/components/incidents/panels";
import { ApprovalPanel } from "@/components/incidents/approval-panel";
import { AgentStatusCards, IncidentMeta, LiveActivity, WorkflowProgress } from "@/components/incidents/side-panels";
import { EvidenceTrail } from "@/components/evidence/evidence-trail";
import { Callout, Skeleton } from "@/components/ui/misc";

export default function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, stream } = useIncident(id);
  if (isLoading) return <div className="space-y-4 p-6"><Skeleton className="h-20" /><div className="grid gap-5 xl:grid-cols-[1fr_380px]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div>;
  if (error || !data) return <div className="p-6"><Callout tone="danger" title="Could not load this incident">{(error as ApiError)?.message ?? "Unknown error"}</Callout></div>;
  return (
    <div>
      <IncidentHeader d={data} />
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <ReportCard d={data} />
          <FindingsCard d={data} />
          <EvidenceTrail evidence={data.evidence} />
          <CodeChangesCard d={data} />
          <QACard d={data} />
          <ApprovalPanel d={data} />
        </div>
        <div className="space-y-5">
          <AgentStatusCards d={data} />
          <LiveActivity events={stream.events.length ? stream.events : data.events} state={stream.state} incidentId={id} />
          <WorkflowProgress d={data} />
          <IncidentMeta d={data} />
        </div>
      </div>
    </div>
  );
}
