"use client";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Ban, ExternalLink, FolderGit2, GitPullRequest, MessagesSquare, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/src/client/api";
import type { IncidentDetail } from "@/src/client/incident-types";
import { dateTime } from "@/src/utils/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { Callout } from "@/components/ui/misc";
import { SeverityBadge, StatusBadge } from "./badges";

const RETRYABLE = ["FAILED", "BLOCKED", "REJECTED", "NEEDS_INFORMATION"];
const TERMINAL = ["RESOLVED", "CANCELLED"];

export function IncidentHeader({ d, room }: { d: IncidentDetail; room?: boolean }) {
  const i = d.incident;
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["incident", i.id] });
  const cancel = useMutation({ mutationFn: () => api(`/api/incidents/${i.id}/cancel`, { method: "POST" }), onSuccess: () => setCancelOpen(false), onSettled: refresh });
  const retry = useMutation({ mutationFn: () => api(`/api/incidents/${i.id}/retry`, { method: "POST", json: { guidance: guidance.trim() || undefined } }), onSuccess: () => (setRetryOpen(false), setGuidance("")), onSettled: refresh });
  const repoHref = i.repository.htmlUrl ?? `/repositories?highlight=${i.repository.id}`;
  const retryLabel = i.status === "NEEDS_INFORMATION" ? "Add information" : i.status === "FAILED" ? "Retry" : "Send back to Fixer";

  return (
    <div className="border-b border-border px-6 py-5">
      <Link href={room ? `/incidents/${i.id}` : "/incidents"} className="mb-3 inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg">
        <ArrowLeft className="size-3.5" /> {room ? `INC-${i.number}` : "Incidents"}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-fg-subtle">INC-{i.number}</span>
            <StatusBadge status={i.status} />
            <SeverityBadge severity={i.severity} />
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">{room ? `Collaboration room` : i.title}</h1>
          <p className="mt-1 text-xs text-fg-subtle">
            {room ? <>{i.title} · </> : null}
            <span className="font-mono">{i.repository.fullName}</span> · opened {dateTime(i.createdAt)}
            {i.switchRoomName && <> · room <span className="font-mono">{i.switchRoomName}</span></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!room && (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/incidents/${i.id}/room`}>
                <MessagesSquare /> Collaboration room
              </Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <a href={repoHref} target={i.repository.htmlUrl ? "_blank" : undefined} rel="noreferrer">
              <FolderGit2 /> View repository {i.repository.htmlUrl && <ExternalLink className="!size-3" />}
            </a>
          </Button>
          {i.pullRequestUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={i.pullRequestUrl} target="_blank" rel="noreferrer">
                <GitPullRequest /> View pull request
              </a>
            </Button>
          )}
          {RETRYABLE.includes(i.status) && (
            <Button variant="primary" size="sm" onClick={() => setRetryOpen(true)}>
              <RotateCcw /> {retryLabel}
            </Button>
          )}
          {!TERMINAL.includes(i.status) && (
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
              <Ban /> Cancel investigation
            </Button>
          )}
        </div>
      </div>
      {i.lastError && !TERMINAL.includes(i.status) && (
        <Callout tone={i.status === "FAILED" ? "danger" : "warning"} className="mt-4" title={i.status === "FAILED" ? "The workflow stopped" : "Needs your attention"}>
          {i.lastError}
        </Callout>
      )}

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title={`Cancel INC-${i.number}?`} description="Running agent work is stopped. Findings, evidence and the branch are kept.">
          {cancel.error && <Callout tone="danger" className="mb-3">{(cancel.error as ApiError).message}</Callout>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep going</Button>
            <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel investigation</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={retryOpen} onOpenChange={setRetryOpen}>
        <DialogContent title={retryLabel} description={i.status === "FAILED" ? "Resumes from the stage that stopped. Earlier findings are reused." : "Gives the Fixer a fresh set of attempts with your guidance. It is posted to the Switch room."}>
          <form onSubmit={(e) => (e.preventDefault(), retry.mutate())} className="space-y-3">
            <div>
              <Label htmlFor="guidance">{i.status === "NEEDS_INFORMATION" ? "Additional information" : "Guidance (optional)"}</Label>
              <Textarea id="guidance" className="mt-1" rows={4} value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="e.g. Keep the response format unchanged; initialise the profile in the store." />
            </div>
            {retry.error && <Callout tone="danger">{(retry.error as ApiError).message}</Callout>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRetryOpen(false)}>Close</Button>
              <Button type="submit" variant="primary" loading={retry.isPending}><RotateCcw /> {retryLabel}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
