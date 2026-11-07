"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { FlaskConical, Play } from "lucide-react";
import { api, ApiError } from "@/src/client/api";
import { useRepositories, useSystemStatus } from "@/src/client/hooks";
import { useWorkspace } from "@/src/client/workspace-context";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { Callout } from "@/components/ui/misc";

const schema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(160),
  description: z.string().trim().min(20, "Describe the bug in at least 20 characters").max(10_000),
  repositoryId: z.string().min(1, "Choose a repository"),
  errorMessage: z.string().max(4000).optional(),
  stackTrace: z.string().max(20000).optional(),
  reproductionSteps: z.string().max(6000).optional(),
});
type Form = z.infer<typeof schema>;

const DEMO = {
  title: "Registration endpoint returns HTTP 500",
  description: "Users cannot complete registration. The endpoint returns a server error instead of creating an account. Please investigate and fix the problem.",
};

export default function NewIncidentPage() {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const repos = useRepositories();
  const status = useSystemStatus();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setValue, setError: setFieldError, watch } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { title: "", description: "", repositoryId: "" } });
  const connected = useMemo(() => repos.data?.filter((r) => r.connectionStatus === "CONNECTED") ?? [], [repos.data]);
  const selected = connected.find((r) => r.id === watch("repositoryId"));

  useEffect(() => {
    if (connected.length && !watch("repositoryId")) setValue("repositoryId", connected[0].id);
  }, [connected, setValue, watch]);

  const onSubmit = async (v: Form) => {
    setError(null);
    try {
      const { incident } = await api<{ incident: { id: string } }>("/api/incidents", { method: "POST", json: { ...v, workspaceId, autoStart: true } });
      router.push(`/incidents/${incident.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.issues) e.issues.forEach((i) => setFieldError(i.path as keyof Form, { message: i.message }));
      setError(e instanceof ApiError ? e.message : "Could not create the incident");
    }
  };

  return (
    <div>
      <PageHeader title="Report a bug" description="Describe what's broken. Triage will classify it and the team takes it from there." />
      <div className="mx-auto max-w-3xl p-6">
        {status.data && !status.data.ai.available && (
          <Callout tone="warning" title="AI provider not configured" className="mb-4">
            {status.data.ai.detail}
          </Callout>
        )}
        <Card className="p-5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-surface-2 px-3 py-2">
              <p className="text-xs text-fg-muted">
                <FlaskConical className="mr-1.5 inline size-3.5 text-accent" />
                Trying PATCHWORK? Fill in the demo scenario for the bundled repository.
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setValue("title", DEMO.title, { shouldValidate: true });
                  setValue("description", DEMO.description, { shouldValidate: true });
                  const demo = connected.find((r) => r.provider === "LOCAL");
                  if (demo) setValue("repositoryId", demo.id);
                }}
              >
                Use demo scenario
              </Button>
            </div>

            <div>
              <Label htmlFor="title">Incident title</Label>
              <Input id="title" className="mt-1" placeholder="e.g. Checkout returns 500 for saved cards" aria-invalid={!!formState.errors.title} {...register("title")} />
              <FieldError message={formState.errors.title?.message} />
            </div>
            <div>
              <Label htmlFor="description">Bug description</Label>
              <Textarea id="description" rows={5} className="mt-1" placeholder="What happens, what you expected, who is affected." aria-invalid={!!formState.errors.description} {...register("description")} />
              <FieldError message={formState.errors.description?.message} />
            </div>
            <div>
              <Label htmlFor="repositoryId">Repository</Label>
              <Select id="repositoryId" className="mt-1" aria-invalid={!!formState.errors.repositoryId} {...register("repositoryId")} disabled={repos.isLoading}>
                {repos.isLoading && <option>Loading…</option>}
                {!repos.isLoading && !connected.length && <option value="">No repositories connected</option>}
                {connected.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName} {r.provider === "LOCAL" ? "(local demo)" : `(${r.visibility})`}
                  </option>
                ))}
              </Select>
              <FieldError message={formState.errors.repositoryId?.message} />
              {selected && <p className="mt-1 text-[11px] text-fg-subtle">Agents will work on a new branch from <span className="font-mono">{selected.defaultBranch}</span>; it is never modified directly.</p>}
              {!repos.isLoading && !connected.length && (
                <p className="mt-1 text-xs text-fg-subtle">
                  <Link href="/repositories" className="underline">Connect a repository</Link> first.
                </p>
              )}
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="errorMessage">Error message <span className="text-fg-subtle">(optional)</span></Label>
                <Textarea id="errorMessage" rows={3} className="mt-1 font-mono text-xs" placeholder="HTTP 500 Internal server error" {...register("errorMessage")} />
              </div>
              <div>
                <Label htmlFor="reproductionSteps">Reproduction steps <span className="text-fg-subtle">(optional)</span></Label>
                <Textarea id="reproductionSteps" rows={3} className="mt-1" placeholder={"1. POST /api/register\n2. …"} {...register("reproductionSteps")} />
              </div>
            </div>
            <div>
              <Label htmlFor="stackTrace">Stack trace <span className="text-fg-subtle">(optional)</span></Label>
              <Textarea id="stackTrace" rows={4} className="mt-1 font-mono text-xs" placeholder="TypeError: …" {...register("stackTrace")} />
            </div>
            <p className="text-[11px] leading-relaxed text-fg-subtle">Report contents are treated as untrusted data by every agent. Likely secrets (tokens, keys) are redacted before storage.</p>
            {error && <Callout tone="danger">{error}</Callout>}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={formState.isSubmitting} disabled={!connected.length}>
                <Play /> Start Investigation
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
