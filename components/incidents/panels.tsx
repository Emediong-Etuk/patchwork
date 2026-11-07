"use client";
import { useState } from "react";
import { AlertTriangle, Bug, ChevronDown, ChevronRight, CircleCheck, CircleX, FileCode2, FlaskConical, GitCommitHorizontal, Lightbulb, ShieldQuestion } from "lucide-react";
import type { ChangeRow, IncidentDetail, TestRunRow } from "@/src/client/incident-types";
import { AGENT_META, ROLE_BY_AGENT_ID } from "@/src/client/display";
import { dateTime, duration } from "@/src/utils/format";
import { cn } from "@/src/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { DiffViewer } from "./diff-viewer";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <div className="text-sm leading-relaxed text-fg-muted">{children}</div>
    </div>
  );
}

function Pre({ children, className }: { children: React.ReactNode; className?: string }) {
  return <pre className={cn("max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 font-mono text-[11.5px] leading-5 text-fg scrollbar-thin", className)}>{children}</pre>;
}

export function ReportCard({ d }: { d: IncidentDetail }) {
  const i = d.incident;
  return (
    <Card>
      <CardHeader icon={<Bug />} title="Original report" description={`Submitted ${dateTime(i.createdAt)}`} />
      <CardBody className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{i.description}</p>
        {i.errorMessage && <Section label="Error message"><Pre>{i.errorMessage}</Pre></Section>}
        {i.stackTrace && <Section label="Stack trace"><Pre>{i.stackTrace}</Pre></Section>}
        {i.reproductionSteps && <Section label="Reproduction steps"><p className="whitespace-pre-wrap">{i.reproductionSteps}</p></Section>}
      </CardBody>
    </Card>
  );
}

export function FindingsCard({ d }: { d: IncidentDetail }) {
  const t = d.reports.triage?.report;
  const inv = d.reports.investigation?.report;
  if (!t && !inv)
    return (
      <Card>
        <CardHeader icon={<Lightbulb />} title="Investigation findings" />
        <EmptyState title="No findings yet" description="Triage and the Investigator publish their structured reports here." />
      </Card>
    );
  return (
    <Card>
      <CardHeader icon={<Lightbulb />} title="Investigation findings" description={inv ? `Investigator · ${inv.confidence} confidence` : "Triage complete; investigation in progress"} />
      <CardBody className="space-y-5">
        {t && (
          <div className="rounded-md border border-border bg-surface-2/60 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-warning">Triage</span>
              <Badge>{t.classification}</Badge>
              <Badge tone="warning">{t.severity}</Badge>
            </div>
            <p className="text-xs leading-relaxed text-fg-muted">{t.severityRationale}</p>
            <p className="mt-2 text-xs text-fg-muted">
              <span className="text-fg-subtle">Hypothesis (unverified): </span>
              {t.initialHypothesis}
            </p>
            {t.missingInformation.length > 0 && <p className="mt-2 text-xs text-fg-subtle">Missing information: {t.missingInformation.join("; ")}</p>}
          </div>
        )}
        {inv && (
          <>
            <Section label="Root cause">
              <p className="text-fg">{inv.rootCause}</p>
            </Section>
            <div className="grid gap-4 md:grid-cols-2">
              <Section label="Observed">{inv.observedBehavior}</Section>
              <Section label="Expected">{inv.expectedBehavior}</Section>
            </div>
            <Section label="Reproduction">
              <span className="flex items-center gap-1.5">
                {inv.reproduction.reproduced ? <CircleCheck className="size-3.5 text-success" /> : <ShieldQuestion className="size-3.5 text-fg-subtle" />}
                {inv.reproduction.reproduced ? <>Reproduced with <code className="font-mono text-fg">{inv.reproduction.command}</code></> : "Not reproduced"}
              </span>
              <p className="mt-1 text-xs">{inv.reproduction.details}</p>
            </Section>
            {inv.codeLocations.length > 0 && (
              <Section label="Code locations">
                <ul className="space-y-1">
                  {inv.codeLocations.map((c, k) => (
                    <li key={k} className="text-xs">
                      <code className="font-mono text-fg">{c.path}:{c.lineStart}{c.lineEnd !== c.lineStart ? `-${c.lineEnd}` : ""}</code> — {c.description}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Section label="Recommended fix">{inv.recommendedFix}</Section>
            {inv.hypotheses.length > 0 && <Section label="Unverified hypotheses"><ul className="list-disc space-y-0.5 pl-4 text-xs">{inv.hypotheses.map((h, k) => <li key={k}>{h}</li>)}</ul></Section>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

function FileDiff({ c }: { c: ChangeRow }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 bg-surface-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="size-3.5 text-fg-subtle" /> : <ChevronRight className="size-3.5 text-fg-subtle" />}
        <span className="font-mono text-xs text-fg">{c.filePath}</span>
        <Badge tone={c.changeType === "ADDED" ? "success" : c.changeType === "DELETED" ? "danger" : "neutral"}>{c.changeType.toLowerCase()}</Badge>
        <span className="ml-auto font-mono text-[11px]">
          <span className="text-success">+{c.additions}</span> <span className="text-danger">−{c.deletions}</span>
        </span>
      </button>
      {open && <DiffViewer diff={c.diff} className="border-t border-border bg-surface" />}
    </div>
  );
}

export function CodeChangesCard({ d }: { d: IncidentDetail }) {
  const attempts = [...new Set(d.changes.map((c) => c.attempt))].sort((a, b) => a - b);
  const [sel, setSel] = useState<number | null>(null);
  const attempt = sel ?? attempts[attempts.length - 1];
  const files = d.changes.filter((c) => c.attempt === attempt);
  const add = files.reduce((n, c) => n + c.additions, 0);
  const del = files.reduce((n, c) => n + c.deletions, 0);
  const fix = d.reports.fix;
  return (
    <Card>
      <CardHeader
        icon={<FileCode2 />}
        title="Code changes"
        description={d.incident.workingBranch ? <span className="font-mono">{d.incident.workingBranch} ← {d.incident.repository.defaultBranch}@{d.incident.baseCommit?.slice(0, 8)}</span> : "No branch yet"}
        actions={
          attempts.length > 1 && (
            <div className="flex gap-1" role="tablist" aria-label="Fix attempt">
              {attempts.map((a) => (
                <button key={a} role="tab" aria-selected={a === attempt} onClick={() => setSel(a)} className={cn("rounded px-1.5 py-0.5 text-[11px] text-fg-subtle hover:text-fg", a === attempt && "bg-surface-3 text-fg")}>
                  Attempt {a}
                </button>
              ))}
            </div>
          )
        }
      />
      {!files.length ? (
        <EmptyState icon={<FileCode2 />} title="No changes yet" description="The Fixer's edits are committed to the incident branch and the diff is captured here." />
      ) : (
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
            <span>{files.length} file{files.length === 1 ? "" : "s"} changed</span>
            <span className="font-mono"><span className="text-success">+{add}</span> <span className="text-danger">−{del}</span></span>
            {files[0].commitSha && (
              <span className="flex items-center gap-1 font-mono text-fg-subtle">
                <GitCommitHorizontal className="size-3.5" /> {files[0].commitSha.slice(0, 10)}
              </span>
            )}
            <span className="text-fg-subtle">cumulative diff against the default branch</span>
          </div>
          {fix && fix.attempt === attempt && (
            <div className="rounded-md border border-accent/25 bg-accent-soft/40 p-3 text-xs leading-relaxed text-fg-muted">
              <p className="mb-1 font-semibold text-accent">Fixer&apos;s summary</p>
              <p className="text-fg">{fix.report.summary}</p>
              <p className="mt-1.5"><span className="text-fg-subtle">Why it works (claim): </span>{fix.report.whyItWorks}</p>
              {fix.report.potentialSideEffects.length > 0 && <p className="mt-1.5"><span className="text-fg-subtle">Side effects: </span>{fix.report.potentialSideEffects.join("; ")}</p>}
              {fix.report.respondedToFeedback && <p className="mt-1.5"><span className="text-fg-subtle">Response to QA: </span>{fix.report.respondedToFeedback}</p>}
            </div>
          )}
          {files.map((c) => <FileDiff key={c.id} c={c} />)}
        </CardBody>
      )}
    </Card>
  );
}

function TestRunItem({ t }: { t: TestRunRow }) {
  const [open, setOpen] = useState(false);
  const role = t.agentId ? ROLE_BY_AGENT_ID[t.agentId] : null;
  const ok = t.status === "PASSED";
  return (
    <li className="rounded-md border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {ok ? <CircleCheck className="size-4 text-success" /> : t.status === "TIMED_OUT" ? <AlertTriangle className="size-4 text-warning" /> : <CircleX className="size-4 text-danger" />}
        <code className="font-mono text-xs text-fg">{t.command}</code>
        <Badge tone={ok ? "success" : "danger"}>{t.status.replace("_", " ").toLowerCase()}</Badge>
        <span className="ml-auto text-[11px] text-fg-subtle">{role ? AGENT_META[role].short : ""} · attempt {t.attempt} · exit {t.exitCode ?? "—"} · {duration(t.durationMs)}</span>
      </button>
      {open && <Pre className="m-3 mt-0 max-h-96">{[t.output, t.errorOutput].filter(Boolean).join("\n") || "(no output)"}</Pre>}
    </li>
  );
}

export function QACard({ d }: { d: IncidentDetail }) {
  const qa = d.reports.qa;
  const r = qa?.report;
  return (
    <Card>
      <CardHeader icon={<FlaskConical />} title="QA report" description={r ? `Attempt ${qa!.attempt} · PATCHWORK_QA` : "Waiting for a fix to verify"} actions={r && <Badge tone={r.verdict === "PASS" ? "success" : r.verdict === "FAIL" ? "danger" : "warning"}>{r.verdict.replace("_", " ")}</Badge>} />
      <CardBody className="space-y-4">
        {qa?.override && <div className="rounded-md border border-danger/30 bg-danger-soft p-2.5 text-xs text-fg-muted"><span className="font-medium text-danger">Verdict overridden by PATCHWORK: </span>{qa.override}</div>}
        {r && (
          <>
            <Section label="Summary">{r.testSummary}</Section>
            <div className="grid gap-4 md:grid-cols-2">
              <Section label="Implementation review">{r.implementationReview}</Section>
              <Section label="Regression analysis">{r.regressionAnalysis}</Section>
            </div>
            {r.failureDetailsForFixer && r.verdict !== "PASS" && <Section label="Returned to the Fixer">{r.failureDetailsForFixer}</Section>}
            {r.outstandingConcerns.length > 0 && <Section label="Outstanding concerns"><ul className="list-disc pl-4 text-xs">{r.outstandingConcerns.map((c, k) => <li key={k}>{c}</li>)}</ul></Section>}
          </>
        )}
        {d.reports.qaHistory.length > 1 && (
          <Section label="History">
            <div className="flex flex-wrap gap-1.5">
              {d.reports.qaHistory.map((h) => (
                <Badge key={h.attempt} tone={h.verdict === "PASS" ? "success" : h.verdict === "FAIL" ? "danger" : "warning"}>Attempt {h.attempt}: {h.verdict}</Badge>
              ))}
            </div>
          </Section>
        )}
        <Section label={`Test runs (${d.testRuns.length}) — recorded from real execution`}>
          {d.testRuns.length ? <ul className="space-y-2">{[...d.testRuns].reverse().map((t) => <TestRunItem key={t.id} t={t} />)}</ul> : <p className="text-xs text-fg-subtle">No commands executed yet.</p>}
        </Section>
      </CardBody>
    </Card>
  );
}
