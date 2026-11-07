"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CircleCheck, GitPullRequest, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { api, ApiError } from "@/src/client/api";
import type { IncidentDetail } from "@/src/client/incident-types";
import { dateTime } from "@/src/utils/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FieldError, Label, Textarea } from "@/components/ui/input";
import { Callout } from "@/components/ui/misc";

export function ApprovalPanel({ d }: { d: IncidentDetail }) {
  const qc = useQueryClient();
  const i = d.incident;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [createPr, setCreatePr] = useState(i.repository.provider === "GITHUB");
  const refresh = () => qc.invalidateQueries({ queryKey: ["incident", i.id] });
  const approve = useMutation({ mutationFn: () => api(`/api/incidents/${i.id}/approve`, { method: "POST", json: { createPullRequest: createPr } }), onSettled: refresh });
  const reject = useMutation({ mutationFn: () => api(`/api/incidents/${i.id}/reject`, { method: "POST", json: { reason } }), onSuccess: () => setRejecting(false), onSettled: refresh });
  const pr = useMutation({ mutationFn: () => api(`/api/incidents/${i.id}/pull-request`, { method: "POST" }), onSettled: refresh });

  const awaiting = i.status === "AWAITING_APPROVAL";
  const qa = d.reports.qa;
  const lastRuns = d.testRuns.filter((t) => t.agentId === "agent_qa" && t.attempt === (qa?.attempt ?? i.fixAttempts));
  const err = (approve.error ?? reject.error ?? pr.error) as ApiError | null;

  return (
    <Card className={awaiting ? "border-warning/40" : undefined}>
      <CardHeader icon={<ShieldCheck />} title="Approval" description="A human decides. Approving never merges: it opens a pull request (GitHub) or preserves the branch." actions={awaiting && <Badge tone="warning">Your review is needed</Badge>} />
      <CardBody className="space-y-4">
        {!awaiting && !d.approvals.length && <p className="text-xs text-fg-subtle">Approval controls unlock when QA has verified a fix with executed tests.</p>}

        {(awaiting || d.approvals.length > 0) && qa && (
          <div className="rounded-md border border-border bg-surface-2/60 p-3">
            <div className="flex items-center gap-2">
              {qa.report.verdict === "PASS" ? <CircleCheck className="size-4 text-success" /> : null}
              <p className="text-sm font-medium">QA {qa.report.verdict} on attempt {qa.attempt}</p>
            </div>
            <ul className="mt-2 space-y-1">
              {lastRuns.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <Badge tone={t.status === "PASSED" ? "success" : "danger"}>{t.status.toLowerCase()}</Badge>
                  <code className="font-mono text-fg">{t.command}</code>
                  <span className="text-fg-subtle">exit {t.exitCode}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-fg-muted">{qa.report.testSummary}</p>
          </div>
        )}

        {awaiting && (
          <>
            <label className="flex items-start gap-2 text-xs text-fg-muted">
              <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={createPr} disabled={i.repository.provider !== "GITHUB"} onChange={(e) => setCreatePr(e.target.checked)} />
              <span>
                Open a GitHub pull request after approval
                {i.repository.provider !== "GITHUB" && <span className="block text-fg-subtle">Not available: this is a local repository. The branch {i.workingBranch} is preserved instead.</span>}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant="success" onClick={() => approve.mutate()} loading={approve.isPending}>
                <ThumbsUp /> Approve Fix
              </Button>
              <Button variant="danger" onClick={() => setRejecting(true)}>
                <ThumbsDown /> Reject Fix
              </Button>
            </div>
          </>
        )}

        {i.status === "APPROVED" && i.repository.provider === "GITHUB" && !i.pullRequestUrl && (
          <Button variant="primary" onClick={() => pr.mutate()} loading={pr.isPending}>
            <GitPullRequest /> Create pull request
          </Button>
        )}
        {i.pullRequestUrl && (
          <a href={i.pullRequestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
            <GitPullRequest className="size-4" /> Pull request #{i.pullRequestNumber} (not merged)
          </a>
        )}

        {err && <Callout tone="danger">{err.message}</Callout>}

        {d.approvals.length > 0 && (
          <ul className="space-y-2 border-t border-border pt-3">
            {d.approvals.map((a) => (
              <li key={a.id} className="text-xs text-fg-muted">
                <Badge tone={a.decision === "APPROVED" ? "success" : "danger"}>{a.decision.toLowerCase()}</Badge> by <span className="text-fg">{a.user.name}</span> · {dateTime(a.createdAt)}
                {a.reason && <p className="mt-1 pl-1 text-fg-muted">“{a.reason}”</p>}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent title="Reject this fix" description="Your reason is recorded on the incident and posted to the Switch room.">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 5) return setReasonError("Give a reason of at least 5 characters");
              setReasonError(undefined);
              reject.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="reason">Reason</Label>
              <Textarea id="reason" className="mt-1" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The fix changes the response format; keep displayName at the top level." aria-invalid={!!reasonError} />
              <FieldError message={reasonError} />
            </div>
            <p className="text-[11px] text-fg-subtle">After rejecting you can send the fix back to the Fixer with guidance.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
              <Button type="submit" variant="danger" loading={reject.isPending}>Reject Fix</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
