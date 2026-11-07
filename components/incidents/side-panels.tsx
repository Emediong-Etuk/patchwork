"use client";
import Link from "next/link";
import { Activity, Bot, Check, Info, MessagesSquare, Radio } from "lucide-react";
import type { StreamEvent } from "@/src/lib/events/types";
import type { IncidentDetail } from "@/src/client/incident-types";
import { AGENT_META, AGENT_STATUS_META, ROLE_BY_AGENT_ID, WORKFLOW_STAGES } from "@/src/client/display";
import type { StreamState } from "@/src/client/use-event-stream";
import { clockTime, dateTime, timeAgo } from "@/src/utils/format";
import { cn } from "@/src/utils/cn";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, StatusDot } from "@/components/ui/misc";

export function AgentStatusCards({ d }: { d: IncidentDetail }) {
  return (
    <Card>
      <CardHeader icon={<Bot />} title="Agents" description="Status on this incident" />
      <ul className="divide-y divide-border/60">
        {d.agents.map((a) => {
          const m = AGENT_STATUS_META[a.status] ?? AGENT_STATUS_META.IDLE;
          return (
            <li key={a.id} className="flex gap-2.5 px-4 py-3">
              <AgentAvatar role={a.role} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold">{AGENT_META[a.role]?.name ?? a.name}</p>
                  <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-fg-muted">
                    <StatusDot tone={m.tone} pulse={m.pulse} /> {m.label}
                  </span>
                </div>
                <p className="text-[11px] text-fg-subtle">{AGENT_META[a.role]?.role} · <span className="font-mono">{a.model}</span></p>
                <p className="mt-1 truncate text-xs text-fg-muted" title={a.currentTask ?? undefined}>{a.currentTask ?? "No task yet"}</p>
                <p className="text-[11px] text-fg-subtle">{a.lastActivity ? `Last activity ${timeAgo(a.lastActivity)}` : "Not started"}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const QUIET = new Set(["AGENT_TOOL_CALL"]);

export function LiveActivity({ events, state, incidentId }: { events: StreamEvent[]; state: StreamState; incidentId: string }) {
  const shown = [...events].reverse().slice(0, 120);
  return (
    <Card>
      <CardHeader
        icon={<Activity />}
        title="Live collaboration"
        actions={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle" aria-live="polite">
              <StatusDot tone={state === "live" ? "success" : state === "offline" ? "danger" : "warning"} pulse={state !== "live"} />
              {state === "live" ? "Live" : state === "offline" ? "Offline — retrying" : state === "reconnecting" ? "Reconnecting" : "Connecting"}
            </span>
            <Link href={`/incidents/${incidentId}/room`} className="flex items-center gap-1 text-[11px] text-accent hover:underline">
              <MessagesSquare className="size-3.5" /> Room
            </Link>
          </div>
        }
      />
      {!shown.length ? (
        <EmptyState title="Waiting for activity" description="Events appear here the moment they are persisted." />
      ) : (
        <ol className="max-h-[440px] overflow-y-auto px-4 py-2 scrollbar-thin" aria-label="Incident activity">
          {shown.map((e) => {
            const role = e.actorId ? ROLE_BY_AGENT_ID[e.actorId] : null;
            const quiet = QUIET.has(e.eventType);
            return (
              <li key={e.seq} className={cn("flex gap-2 py-1.5", quiet && "opacity-70")}>
                <span className="mt-0.5 w-14 shrink-0 font-mono text-[10px] text-fg-subtle">{clockTime(e.createdAt)}</span>
                {quiet ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" /> : <AgentAvatar role={role} size="sm" human={e.actorType === "USER"} system={e.actorType === "SYSTEM"} />}
                <p className={cn("min-w-0 text-xs leading-relaxed", quiet ? "text-fg-subtle" : "text-fg-muted", e.eventType.includes("FAIL") || e.eventType === "WORKFLOW_ERROR" || e.eventType === "INCIDENT_BLOCKED" ? "text-danger" : "", e.eventType === "FIX_PASSED" || e.eventType === "INCIDENT_RESOLVED" ? "text-success" : "")}>
                  {e.description}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

export function WorkflowProgress({ d }: { d: IncidentDetail }) {
  const s = d.incident.status;
  const idx = WORKFLOW_STAGES.findIndex((st) => (st.statuses as readonly string[]).includes(s));
  const failed = ["FAILED", "BLOCKED", "CANCELLED"].includes(s);
  // For a failed/blocked incident, mark the stage where it stopped.
  const stopAt = failed ? (d.tasks.length ? WORKFLOW_STAGES.findIndex((st) => st.key === ({ triage: "triage", investigation: "investigate", fix: "fix", qa: "qa", approval: "approval" } as Record<string, string>)[d.tasks.filter((t) => t.stage !== "consult").at(-1)?.stage ?? "triage"]) : 1) : -1;
  const current = failed ? stopAt : s === "RESOLVED" ? WORKFLOW_STAGES.length : idx;
  return (
    <Card>
      <CardHeader icon={<Radio />} title="Workflow" description={d.incident.fixAttempts ? `Fix attempt ${d.incident.fixAttempts} of ${d.incident.maxFixAttempts}` : undefined} />
      <CardBody>
        <ol className="space-y-0">
          {WORKFLOW_STAGES.map((st, k) => {
            const done = k < current;
            const active = k === current && !failed;
            const stopped = failed && k === stopAt;
            return (
              <li key={st.key} className="relative flex items-center gap-3 py-1.5">
                {k < WORKFLOW_STAGES.length - 1 && <span className={cn("absolute left-[9px] top-6 h-full w-px", done ? "bg-success/50" : "bg-border")} aria-hidden />}
                <span className={cn("relative z-10 flex size-[19px] items-center justify-center rounded-full border text-[10px]", done && "border-success/60 bg-success-soft text-success", active && "border-accent bg-accent-soft text-accent", stopped && "border-danger/60 bg-danger-soft text-danger", !done && !active && !stopped && "border-border-strong bg-surface text-fg-subtle")}>
                  {done ? <Check className="size-3" /> : k + 1}
                </span>
                <span className={cn("text-xs", active ? "font-semibold text-fg" : done ? "text-fg-muted" : stopped ? "text-danger" : "text-fg-subtle")}>
                  {st.label}
                  {active && <span className="ml-2 font-normal text-fg-subtle">current</span>}
                  {stopped && <span className="ml-2 font-normal">stopped — {s.toLowerCase()}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </CardBody>
    </Card>
  );
}

export function IncidentMeta({ d }: { d: IncidentDetail }) {
  const i = d.incident;
  const rows: [string, React.ReactNode][] = [
    ["Switch room", i.switchRoomId ? <span className="font-mono" title={i.switchRoomId}>{i.switchRoomName}</span> : "Not created"],
    ["Room id", i.switchRoomId ? <span className="break-all font-mono text-[10.5px]">{i.switchRoomId}</span> : "—"],
    ["Transport", i.switchMode ? <Badge tone={i.switchMode === "live" ? "success" : "warning"}>{i.switchMode === "live" ? "Switch (live)" : "Simulated locally"}</Badge> : "—"],
    ["Repository", <span key="r" className="font-mono">{i.repository.fullName}</span>],
    ["Branch", i.workingBranch ? <span className="font-mono">{i.workingBranch}</span> : "—"],
    ["Base commit", i.baseCommit ? <span className="font-mono">{i.baseCommit.slice(0, 10)}</span> : "—"],
    ["Head commit", i.headCommit ? <span className="font-mono">{i.headCommit.slice(0, 10)}</span> : "—"],
    ["Messages", d.messages.length],
    ["Evidence", `${d.evidence.filter((e) => e.verificationStatus === "VERIFIED").length} verified / ${d.evidence.length}`],
    ["Test runs", d.testRuns.length],
    ["Created", dateTime(i.createdAt)],
    ["Resolved", dateTime(i.resolvedAt)],
  ];
  return (
    <Card>
      <CardHeader icon={<Info />} title="Incident metadata" />
      <CardBody>
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-subtle">{k}</dt>
              <dd className="min-w-0 text-fg-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
