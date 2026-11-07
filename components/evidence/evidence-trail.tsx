"use client";
import { useMemo, useState } from "react";
import { CircleCheck, CircleDashed, CircleSlash, History, FileCode, FileSearch, FlaskConical, GitBranch, MessageSquareQuote, ScrollText, Terminal, Package } from "lucide-react";
import type { EvidenceRow } from "@/src/client/incident-types";
import { AGENT_META, EVIDENCE_TYPE_LABEL, ROLE_BY_AGENT_ID, VERIFICATION_META } from "@/src/client/display";
import { clockTime, dateTime } from "@/src/utils/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { cn } from "@/src/utils/cn";

const TYPE_ICON: Record<string, typeof FileCode> = { CODE_REFERENCE: FileCode, ERROR_LOG: ScrollText, STACK_TRACE: ScrollText, TERMINAL_OUTPUT: Terminal, TEST_RESULT: FlaskConical, REPOSITORY_METADATA: GitBranch, AGENT_OBSERVATION: MessageSquareQuote, EXTERNAL_DEPENDENCY: Package };
const STATUS_ICON = { VERIFIED: CircleCheck, UNVERIFIED: CircleDashed, CONTRADICTED: CircleSlash, SUPERSEDED: History } as const;

export function VerificationBadge({ status }: { status: string }) {
  const m = VERIFICATION_META[status];
  const Icon = STATUS_ICON[status as keyof typeof STATUS_ICON] ?? CircleDashed;
  return (
    <Badge tone={m?.tone ?? "neutral"} title={m?.help}>
      <Icon aria-hidden /> {m?.label ?? status}
    </Badge>
  );
}

function agentLabel(agentId: string | null) {
  const role = agentId ? ROLE_BY_AGENT_ID[agentId] : null;
  return role ? AGENT_META[role].name : "PATCHWORK";
}

export function EvidenceDetail({ e }: { e: EvidenceRow }) {
  const role = e.agentId ? ROLE_BY_AGENT_ID[e.agentId] : null;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <VerificationBadge status={e.verificationStatus} />
        <Badge>{EVIDENCE_TYPE_LABEL[e.type] ?? e.type}</Badge>
        {e.attempt > 1 && <Badge>Attempt {e.attempt}</Badge>}
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-fg-subtle">Provided by</dt>
        <dd className="flex items-center gap-1.5"><AgentAvatar role={role} size="sm" system={!role} /> {agentLabel(e.agentId)}</dd>
        <dt className="text-fg-subtle">Claim</dt>
        <dd className="whitespace-pre-wrap leading-relaxed text-fg">{e.description}</dd>
        <dt className="text-fg-subtle">Source</dt>
        <dd className="text-fg-muted">{e.source}</dd>
        {e.filePath && (
          <>
            <dt className="text-fg-subtle">Location</dt>
            <dd className="font-mono text-fg">{e.filePath}{e.lineStart ? `:${e.lineStart}${e.lineEnd && e.lineEnd !== e.lineStart ? `-${e.lineEnd}` : ""}` : ""}</dd>
          </>
        )}
        {e.command && (
          <>
            <dt className="text-fg-subtle">Command</dt>
            <dd className="font-mono text-fg">{e.command}</dd>
          </>
        )}
        <dt className="text-fg-subtle">Verification</dt>
        <dd className="leading-relaxed text-fg-muted">{e.verificationNote ?? VERIFICATION_META[e.verificationStatus]?.help}</dd>
        <dt className="text-fg-subtle">Influence</dt>
        <dd className="text-fg-muted">{e.verificationStatus === "CONTRADICTED" ? `Disregarded: verification contradicted this claim${e.influence ? ` (the agent offered it as: ${e.influence.toLowerCase()})` : ""}` : e.verificationStatus === "SUPERSEDED" ? `No longer current; ${e.influence?.toLowerCase() ?? "kept for history"}` : (e.influence ?? "Recorded for context")}</dd>
        <dt className="text-fg-subtle">Recorded</dt>
        <dd className="text-fg-muted">{dateTime(e.createdAt)}</dd>
      </dl>
      {e.content && (
        <div>
          <p className="mb-1 text-xs text-fg-subtle">Excerpt</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 font-mono text-[11.5px] leading-5 text-fg scrollbar-thin">{e.content}</pre>
        </div>
      )}
    </div>
  );
}

export function EvidenceTrail({ evidence, compact }: { evidence: EvidenceRow[]; compact?: boolean }) {
  const [open, setOpen] = useState<EvidenceRow | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const counts = useMemo(() => evidence.reduce<Record<string, number>>((acc, e) => ((acc[e.verificationStatus] = (acc[e.verificationStatus] ?? 0) + 1), acc), {}), [evidence]);
  const rows = filter === "ALL" ? evidence : evidence.filter((e) => e.verificationStatus === filter);
  return (
    <Card>
      <CardHeader
        icon={<FileSearch />}
        title="Evidence Trail"
        description="Every claim, who made it, where it came from, and whether PATCHWORK could verify it."
        actions={
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter evidence">
            {["ALL", "VERIFIED", "UNVERIFIED", "CONTRADICTED", "SUPERSEDED"].map((s) => (
              <button key={s} role="tab" aria-selected={filter === s} onClick={() => setFilter(s)} className={cn("rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:text-fg", filter === s && "bg-surface-3 text-fg")}>
                {s === "ALL" ? `All ${evidence.length}` : `${VERIFICATION_META[s].label} ${counts[s] ?? 0}`}
              </button>
            ))}
          </div>
        }
      />
      {!rows.length ? (
        <EmptyState icon={<FileSearch />} title={evidence.length ? "Nothing matches this filter" : "No evidence yet"} description="Code references, test results and observations appear here as the agents work." />
      ) : (
        <ol className={cn("relative px-4 py-3", compact && "max-h-[520px] overflow-y-auto scrollbar-thin")}>
          <span className="absolute bottom-4 left-[27px] top-4 w-px bg-border" aria-hidden />
          {rows.map((e) => {
            const Icon = TYPE_ICON[e.type] ?? FileSearch;
            return (
              <li key={e.id} className="relative">
                <button type="button" onClick={() => setOpen(e)} className="group flex w-full gap-3 rounded-md py-2 pl-0 pr-2 text-left hover:bg-surface-2">
                  <span className={cn("relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-surface", e.verificationStatus === "VERIFIED" ? "border-success/50 text-success" : e.verificationStatus === "CONTRADICTED" ? "border-danger/50 text-danger" : e.verificationStatus === "SUPERSEDED" ? "border-info/40 text-info" : "border-border-strong text-fg-subtle")} style={{ marginLeft: 0 }}>
                    <Icon className="size-3" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("text-[13px] font-medium text-fg", e.verificationStatus === "SUPERSEDED" && "text-fg-muted line-through decoration-fg-subtle/50")}>{e.title}</span>
                      <VerificationBadge status={e.verificationStatus} />
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{e.description}</p>
                    <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-fg-subtle">
                      <span>{agentLabel(e.agentId)}</span>
                      <span>·</span>
                      <span>{EVIDENCE_TYPE_LABEL[e.type]}</span>
                      {e.filePath && (
                        <>
                          <span>·</span>
                          <span className="font-mono">{e.filePath}{e.lineStart ? `:${e.lineStart}` : ""}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{clockTime(e.createdAt)}</span>
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent side="right" title={open.title} description="Evidence record">
            <EvidenceDetail e={open} />
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
