"use client";
import { Bot, Cpu, Radio, Terminal } from "lucide-react";
import { useSystemStatus } from "@/src/client/hooks";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Callout, Skeleton, StatusDot } from "@/components/ui/misc";

export default function SettingsPage() {
  const { data, isLoading } = useSystemStatus();
  return (
    <div>
      <PageHeader title="Settings" description="Integration status. Configuration lives in environment variables on the server; secrets are never shown here." />
      <div className="grid gap-5 p-6 xl:grid-cols-2">
        {isLoading || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <Card>
              <CardHeader icon={<Radio />} title="Switch" description="Multi-agent collaboration layer" actions={<Badge tone={data.switch.mode === "live" ? (data.switch.connected ? "success" : "danger") : "warning"}>{data.switch.mode === "live" ? (data.switch.connected ? "Connected" : "Not connected") : "Simulator"}</Badge>} />
              <CardBody className="space-y-3">
                {data.switch.mode === "simulator" ? (
                  <Callout tone="warning" title="Local simulator — not real Switch">
                    Agents talk through an in-process implementation of the Switch agent protocol&apos;s semantics. To use a real Switch deployment set <code className="font-mono">SWITCH_MODE=live</code>, <code className="font-mono">SWITCH_BRIDGE_URL</code> and <code className="font-mono">SWITCH_REGISTRATION_TOKEN</code>, then restart.
                  </Callout>
                ) : (
                  <p className="text-xs text-fg-muted">Bridge: <span className="font-mono">{data.switch.bridgeUrl}</span></p>
                )}
                <p className="text-xs text-fg-subtle">{data.switch.detail}</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-fg-subtle"><th className="py-1 font-medium">Identity</th><th className="py-1 font-medium">Agent id</th><th className="py-1 font-medium">Stream</th><th className="py-1 font-medium">Rooms</th></tr>
                  </thead>
                  <tbody>
                    {data.switch.identities.map((i) => (
                      <tr key={i.key} className="border-t border-border/60">
                        <td className="py-1.5"><p className="font-mono">{i.name}</p><p className="text-[10.5px] text-fg-subtle">{i.displayName}</p></td>
                        <td className="py-1.5 font-mono text-[10.5px] text-fg-subtle">{i.agentId ? `${i.agentId.slice(0, 12)}…` : "—"}</td>
                        <td className="py-1.5"><span className="flex items-center gap-1.5"><StatusDot tone={i.state === "open" ? "success" : i.state === "reconnecting" ? "warning" : "danger"} pulse={i.state !== "open"} /> {i.state}</span>{i.lastError && <p className="text-[10.5px] text-danger">{i.lastError}</p>}</td>
                        <td className="py-1.5 tabular-nums">{i.rooms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<Cpu />} title="AI provider" actions={<Badge tone={data.ai.available ? "success" : "danger"}>{data.ai.available ? "Configured" : "Unavailable"}</Badge>} />
              <CardBody className="space-y-3">
                <p className="text-xs text-fg-muted">Provider: <span className="font-mono">{data.ai.provider}</span> — {data.ai.detail}</p>
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(data.ai.models).map(([k, v]) => (
                      <tr key={k} className="border-t border-border/60"><td className="py-1.5 text-fg-muted"><Bot className="mr-1.5 inline size-3.5" />{k.toLowerCase()}</td><td className="py-1.5 text-right font-mono">{v}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-fg-subtle">Override with TRIAGE_MODEL, INVESTIGATOR_MODEL, FIXER_MODEL and QA_MODEL.</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<Terminal />} title="Execution" description="How agents run commands in repository workspaces" />
              <CardBody className="space-y-2 text-xs text-fg-muted">
                <p>Isolation: <Badge tone={data.execution.mode === "docker" ? "success" : "warning"}>{data.execution.mode}</Badge> {data.execution.mode === "process" && <span className="text-fg-subtle">— set EXECUTION_MODE=docker for container isolation without network access.</span>}</p>
                <p>Command timeout: {Math.round(data.execution.timeoutMs / 1000)} s · Automatic fix attempts: {data.execution.maxFixAttempts}</p>
                <p className="text-fg-subtle">Commands are parsed into argv (no shell) and must match the allowlist: test runners such as <code className="font-mono">npm test</code>, <code className="font-mono">node --test</code>, <code className="font-mono">pytest</code>, <code className="font-mono">go test</code>. The environment contains no credentials.</p>
              </CardBody>
            </Card>
            {data.runtimeError && <Callout tone="danger" title="Runtime error">{data.runtimeError}</Callout>}
          </>
        )}
      </div>
    </div>
  );
}
