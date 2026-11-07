"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { FlaskConical, FolderGit2, Github, Globe, KeyRound, Lock, Plug, Unplug } from "lucide-react";
import { api, ApiError } from "@/src/client/api";
import { useRepositories, useSystemStatus } from "@/src/client/hooks";
import { useWorkspace } from "@/src/client/workspace-context";
import { timeAgo } from "@/src/utils/format";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Callout, EmptyState, Skeleton } from "@/components/ui/misc";

type GhRepo = { id: number; fullName: string; defaultBranch: string; visibility: string; description: string | null; pushedAt: string; canPush: boolean };

function ConnectGitHub() {
  const qc = useQueryClient();
  const { me } = useWorkspace();
  const status = useSystemStatus();
  const [token, setToken] = useState("");
  const save = useMutation({ mutationFn: () => api("/api/github/token", { method: "POST", json: { token } }), onSuccess: () => (setToken(""), qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["gh-repos"] })) });
  const disconnect = useMutation({ mutationFn: () => api("/api/github/token", { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });
  if (me?.github)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm"><Github className="size-4" /> Connected as <span className="font-medium">@{me.github.login}</span></p>
        <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()} loading={disconnect.isPending}><Unplug /> Disconnect GitHub</Button>
      </div>
    );
  return (
    <div className="space-y-3">
      {status.data?.github.oauthConfigured && (
        <Button asChild variant="primary"><a href="/api/github/oauth/start"><Github /> Connect with GitHub</a></Button>
      )}
      <form onSubmit={(e) => (e.preventDefault(), save.mutate())} className="space-y-2">
        <Label htmlFor="pat">{status.data?.github.oauthConfigured ? "Or use a fine-grained personal access token" : "Fine-grained personal access token"}</Label>
        <div className="flex gap-2">
          <Input id="pat" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" />
          <Button type="submit" variant="secondary" loading={save.isPending} disabled={token.length < 20}><KeyRound /> Connect</Button>
        </div>
        <p className="text-[11px] leading-relaxed text-fg-subtle">Minimum permissions: Contents read &amp; write (to push the fix branch) and Pull requests read &amp; write, on the repositories you want to use. The token is encrypted at rest and never shown to agents.</p>
        {save.error && <Callout tone="danger">{(save.error as ApiError).message}</Callout>}
      </form>
    </div>
  );
}

function AddRepository({ onDone }: { onDone: () => void }) {
  const { workspaceId, me } = useWorkspace();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const gh = useQuery({ queryKey: ["gh-repos"], enabled: !!me?.github, queryFn: () => api<{ repositories: GhRepo[] }>("/api/repositories/github").then((r) => r.repositories) });
  const connect = useMutation({ mutationFn: (fullName: string) => api("/api/repositories/connect", { method: "POST", json: { provider: "GITHUB", workspaceId, fullName } }), onSuccess: () => (qc.invalidateQueries({ queryKey: ["repositories"] }), onDone()) });
  if (!me?.github) return <ConnectGitHub />;
  const rows = gh.data?.filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase())) ?? [];
  return (
    <div className="space-y-3">
      <Input placeholder="Filter repositories" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter repositories" />
      {gh.isLoading && <Skeleton className="h-40" />}
      {gh.error && <Callout tone="danger">{(gh.error as ApiError).message}</Callout>}
      <ul className="max-h-80 divide-y divide-border/60 overflow-y-auto rounded-md border border-border scrollbar-thin">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2">
            {r.visibility === "public" ? <Globe className="size-3.5 text-fg-subtle" /> : <Lock className="size-3.5 text-fg-subtle" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs">{r.fullName}</p>
              <p className="truncate text-[11px] text-fg-subtle">{r.description ?? "No description"} · pushed {timeAgo(r.pushedAt)}</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => connect.mutate(r.fullName)} loading={connect.isPending && connect.variables === r.fullName}>Connect</Button>
          </li>
        ))}
        {gh.data && !rows.length && <li className="px-3 py-6 text-center text-xs text-fg-subtle">No repositories match.</li>}
      </ul>
      {connect.error && <Callout tone="danger">{(connect.error as ApiError).message}</Callout>}
    </div>
  );
}

function RepositoriesInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const { workspaceId } = useWorkspace();
  const repos = useRepositories();
  const [adding, setAdding] = useState(false);
  const disconnect = useMutation({ mutationFn: (id: string) => api(`/api/repositories/${id}`, { method: "DELETE" }), onSettled: () => qc.invalidateQueries({ queryKey: ["repositories"] }) });
  const reconnectDemo = useMutation({ mutationFn: () => api("/api/repositories/connect", { method: "POST", json: { provider: "DEMO", workspaceId } }), onSettled: () => qc.invalidateQueries({ queryKey: ["repositories"] }) });
  const ghParam = params.get("github");
  const highlight = params.get("highlight");
  return (
    <div>
      <PageHeader title="Repositories" description="Codebases the agents can investigate. Each incident gets its own isolated checkout and branch." actions={<Button variant="primary" onClick={() => setAdding(true)}><Plug /> Connect repository</Button>} />
      <div className="space-y-5 p-6">
        {ghParam === "connected" && <Callout tone="info">GitHub connected.</Callout>}
        {ghParam === "error" && <Callout tone="danger">GitHub connection failed: {params.get("message")}</Callout>}
        <Card>
          <CardHeader icon={<Github />} title="GitHub" description="Used to read repository metadata, clone, push the fix branch and open pull requests. Never used to merge." />
          <CardBody><ConnectGitHub /></CardBody>
        </Card>
        <Card>
          <CardHeader icon={<FolderGit2 />} title="Connected repositories" />
          {repos.isLoading ? (
            <div className="p-4"><Skeleton className="h-24" /></div>
          ) : !repos.data?.length ? (
            <EmptyState icon={<FolderGit2 />} title="No repositories" description="Connect a GitHub repository, or add the bundled demo." action={<Button size="sm" onClick={() => reconnectDemo.mutate()}><FlaskConical /> Add demo repository</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-2 font-medium">Repository</th>
                    <th className="px-4 py-2 font-medium">Owner</th>
                    <th className="px-4 py-2 font-medium">Default branch</th>
                    <th className="px-4 py-2 font-medium">Visibility</th>
                    <th className="px-4 py-2 font-medium">Active incidents</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {repos.data.map((r) => (
                    <tr key={r.id} className={`border-b border-border/60 last:border-0 ${highlight === r.id ? "bg-accent-soft/40" : ""}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {r.provider === "GITHUB" ? <Github className="size-3.5 text-fg-subtle" /> : <FlaskConical className="size-3.5 text-accent" />}
                          {r.htmlUrl ? <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">{r.name}</a> : <span className="font-mono text-xs">{r.name}</span>}
                        </div>
                        {r.description && <p className="mt-0.5 max-w-md truncate text-[11px] text-fg-subtle">{r.description}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-fg-muted">{r.owner}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">{r.defaultBranch}</td>
                      <td className="px-4 py-2.5"><Badge>{r.visibility}</Badge></td>
                      <td className="px-4 py-2.5 text-xs tabular-nums text-fg-muted">{r.activeIncidents} <span className="text-fg-subtle">/ {r._count.incidents} total</span></td>
                      <td className="px-4 py-2.5"><Badge tone={r.connectionStatus === "CONNECTED" ? "success" : "neutral"}>{r.connectionStatus.toLowerCase()}</Badge></td>
                      <td className="px-4 py-2.5 text-right">
                        {r.connectionStatus === "CONNECTED" ? (
                          <Button size="sm" variant="ghost" onClick={() => disconnect.mutate(r.id)} loading={disconnect.isPending && disconnect.variables === r.id}><Unplug /> Disconnect</Button>
                        ) : r.provider === "LOCAL" ? (
                          <Button size="sm" variant="ghost" onClick={() => reconnectDemo.mutate()}><Plug /> Reconnect</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {disconnect.error && <div className="p-4"><Callout tone="danger">{(disconnect.error as ApiError).message}</Callout></div>}
        </Card>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Connect a GitHub repository" description="PATCHWORK clones it into an isolated workspace per incident.">
          <AddRepository onDone={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function RepositoriesPage() {
  return (
    <Suspense>
      <RepositoriesInner />
    </Suspense>
  );
}
