"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, CircleCheck, CircleX, FileCode2, FlaskConical, Radio, Send } from "lucide-react";
import { api, ApiError } from "@/src/client/api";
import type { IncidentDetail, MessageRow } from "@/src/client/incident-types";
import { AGENT_META, ROLE_BY_AGENT_ID } from "@/src/client/display";
import type { StreamState } from "@/src/client/use-event-stream";
import type { StreamEvent } from "@/src/lib/events/types";
import { clockTime } from "@/src/utils/format";
import { cn } from "@/src/utils/cn";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { Callout, EmptyState, StatusDot } from "@/components/ui/misc";

const TYPE_META: Record<string, { label: string; tone: BadgeTone }> = {
  TASK_DELEGATION: { label: "Task delegation", tone: "warning" },
  FINDING: { label: "Investigation finding", tone: "info" },
  IMPLEMENTATION: { label: "Implementation", tone: "accent" },
  QA_REPORT: { label: "QA report", tone: "success" },
  STATUS_UPDATE: { label: "Status update", tone: "neutral" },
  HUMAN: { label: "Human", tone: "neutral" },
  CHAT: { label: "Reply", tone: "neutral" },
  SYSTEM: { label: "System", tone: "danger" },
};

function Attachments({ m, d }: { m: MessageRow; d: IncidentDetail }) {
  const attempt = m.metadata.handoff?.attempt ?? 1;
  if (m.messageType === "FINDING") {
    const ev = d.evidence.filter((e) => e.agentId === "agent_investigator" && e.type !== "AGENT_OBSERVATION").slice(0, 6);
    if (!ev.length) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ev.map((e) => (
          <span key={e.id} className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted" title={e.verificationNote ?? undefined}>
            {e.verificationStatus === "VERIFIED" ? <CircleCheck className="size-3 text-success" /> : e.verificationStatus === "CONTRADICTED" ? <CircleX className="size-3 text-danger" /> : <FileCode2 className="size-3" />}
            {e.filePath ? `${e.filePath}${e.lineStart ? `:${e.lineStart}` : ""}` : e.title.slice(0, 40)}
          </span>
        ))}
      </div>
    );
  }
  if (m.messageType === "IMPLEMENTATION") {
    const files = d.changes.filter((c) => c.attempt === attempt);
    return files.length ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {files.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted">
            <FileCode2 className="size-3" /> {c.filePath} <span className="text-success">+{c.additions}</span> <span className="text-danger">−{c.deletions}</span>
          </span>
        ))}
      </div>
    ) : null;
  }
  if (m.messageType === "QA_REPORT" && m.agentId === "agent_qa") {
    const runs = d.testRuns.filter((t) => t.agentId === "agent_qa" && t.attempt === attempt);
    return runs.length ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {runs.map((t) => (
          <span key={t.id} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10.5px]", t.status === "PASSED" ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger")}>
            <FlaskConical className="size-3" /> {t.command} → {t.status.toLowerCase()}
          </span>
        ))}
      </div>
    ) : null;
  }
  return null;
}

function Bubble({ m, d }: { m: MessageRow; d: IncidentDetail }) {
  const role = m.agentId ? ROLE_BY_AGENT_ID[m.agentId] : null;
  const human = m.senderType === "HUMAN";
  const system = !role && !human;
  const meta = TYPE_META[m.messageType] ?? TYPE_META.STATUS_UPDATE;
  const status = m.messageType === "STATUS_UPDATE" && !m.metadata.to?.length;
  const sw = m.metadata.switch;
  if (status)
    return (
      <div className="flex items-center gap-2 py-1 pl-11 text-[11px] text-fg-subtle">
        <StatusDot tone="neutral" /> <span className={role ? AGENT_META[role].text : ""}>{m.senderName}</span> {m.content} <span className="font-mono">{clockTime(m.createdAt)}</span>
      </div>
    );
  return (
    <div className={cn("flex gap-3 py-2.5", human && "flex-row-reverse")}>
      <AgentAvatar role={role} human={human} system={system} />
      <div className={cn("min-w-0 max-w-[85%]", human && "text-right")}>
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", human && "justify-end")}>
          <span className={cn("text-xs font-semibold", role ? AGENT_META[role].text : "text-fg")}>{human && m.metadata.relayedFor ? m.metadata.relayedFor.name : m.senderName}</span>
          <span className="text-[11px] text-fg-subtle">{role ? AGENT_META[role].role : human ? (m.metadata.source === "switch-room" ? "In the Switch room" : "Developer") : "PATCHWORK"}</span>
          {m.metadata.to && m.metadata.to.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
              <ArrowRight className="size-3" /> {m.metadata.to.join(", ")}
            </span>
          )}
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="font-mono text-[10.5px] text-fg-subtle">{clockTime(m.createdAt)}</span>
        </div>
        <div className={cn("mt-1 inline-block whitespace-pre-wrap rounded-lg border px-3 py-2 text-left text-[13px] leading-relaxed", human ? "border-accent/30 bg-accent-soft/50 text-fg" : system ? "border-danger/25 bg-danger-soft/50 text-fg-muted" : "border-border bg-surface-2 text-fg")}>
          {m.content}
          <Attachments m={m} d={d} />
        </div>
        {sw && (
          <p className={cn("mt-1 flex items-center gap-1 text-[10.5px] text-fg-subtle", human && "justify-end")} title={sw.messageId ? `Switch message ${sw.messageId}` : undefined}>
            {sw.delivered ? <CheckCheck className="size-3 text-success" /> : <Check className="size-3" />}
            {sw.delivered ? "Delivered through" : "Posted to"} {sw.mode === "live" ? "Switch" : "Switch simulator"}
            {m.metadata.mentions?.length ? <> · <span className="font-mono">{m.metadata.mentions.map((n) => `@${n}`).join(" ")}</span></> : null}
            {sw.deliveryAttempts > 1 && <> · {sw.deliveryAttempts} attempts</>}
          </p>
        )}
      </div>
    </div>
  );
}

const SUGGESTIONS = ["Do not modify the API response format.", "Explain why this fix is necessary.", "Run the integration tests too.", "Investigate the payment service too."];

export function CollaborationRoom({ d, events, state }: { d: IncidentDetail; events: StreamEvent[]; state: StreamState }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [target, setTarget] = useState("TRIAGE");
  const bottom = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: () => api(`/api/incidents/${d.incident.id}/message`, { method: "POST", json: { content: text, target } }),
    onSuccess: () => setText(""),
    onSettled: () => qc.invalidateQueries({ queryKey: ["incident", d.incident.id] }),
  });
  const deliveries = useMemo(() => events.filter((e) => e.eventType === "SWITCH_HANDOFF_DELIVERED"), [events]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [d.messages.length]);
  const closed = d.incident.status === "CANCELLED";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="flex min-h-[70vh] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-accent" />
            <div>
              <p className="text-sm font-semibold">{d.incident.switchRoomName ?? "Room not created yet"}</p>
              <p className="text-[11px] text-fg-subtle">{d.incident.switchMode === "live" ? "Switch room" : d.incident.switchMode ? "Simulated Switch room (local development)" : "The room is created when the investigation starts"}</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle" aria-live="polite">
            <StatusDot tone={state === "live" ? "success" : "warning"} pulse={state !== "live"} /> {state === "live" ? "Live" : "Reconnecting"}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-thin" aria-label="Room conversation" role="log">
          {!d.messages.length ? <EmptyState icon={<Radio />} title="No messages yet" description="When the investigation starts, the agents talk to each other here." /> : d.messages.map((m) => <Bubble key={m.id} m={m} d={d} />)}
          <div ref={bottom} />
        </div>
        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) send.mutate();
          }}
        >
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => setText(s)} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-fg-subtle hover:border-border-strong hover:text-fg">
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              aria-label="Message the team"
              rows={2}
              className="min-h-0 flex-1 resize-none"
              placeholder={closed ? "This incident is cancelled" : "Message the team. Your instructions become shared context for every agent."}
              value={text}
              disabled={closed}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) send.mutate();
              }}
            />
            <div className="flex flex-col gap-1.5">
              <Select aria-label="Address to" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-40 text-xs">
                {Object.entries(AGENT_META).map(([k, v]) => (
                  <option key={k} value={k}>@{v.short}</option>
                ))}
              </Select>
              <Button type="submit" variant="primary" size="sm" loading={send.isPending} disabled={!text.trim() || closed}>
                <Send /> Send
              </Button>
            </div>
          </div>
          {send.error && <Callout tone="danger" className="mt-2">{(send.error as ApiError).message}</Callout>}
        </form>
      </Card>

      <div className="space-y-5">
        <Card>
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Participants</p>
          </div>
          <ul className="divide-y divide-border/60">
            {d.agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 px-4 py-2.5">
                <AgentAvatar role={a.role} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{AGENT_META[a.role].name}</p>
                  <p className="text-[11px] text-fg-subtle">{AGENT_META[a.role].role}</p>
                </div>
                <StatusDot tone={a.status === "WORKING" ? "accent" : a.status === "FAILED" ? "danger" : a.status === "WAITING" ? "warning" : "success"} pulse={a.status === "WORKING" || a.status === "WAITING"} />
              </li>
            ))}
            <li className="flex items-center gap-2.5 px-4 py-2.5">
              <AgentAvatar human size="sm" />
              <div>
                <p className="text-xs font-medium">You (via PATCHWORK Console)</p>
                <p className="text-[11px] text-fg-subtle">Supervising developer</p>
              </div>
            </li>
          </ul>
        </Card>
        <Card>
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Switch deliveries</p>
            <p className="text-[11px] text-fg-subtle">Each handoff as it reached the receiving agent&apos;s event stream</p>
          </div>
          {!deliveries.length ? (
            <p className="px-4 py-4 text-xs text-fg-subtle">None yet.</p>
          ) : (
            <ol className="max-h-80 space-y-2 overflow-y-auto px-4 py-3 scrollbar-thin">
              {deliveries.map((e) => (
                <li key={e.seq} className="text-[11px] leading-relaxed text-fg-muted">
                  <span className="mr-1.5 font-mono text-fg-subtle">{clockTime(e.createdAt)}</span>
                  {e.description}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
