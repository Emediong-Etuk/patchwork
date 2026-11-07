import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SEVERITY_META, STATUS_META } from "@/src/client/display";

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={m.tone}>
      {m.active && <Loader2 className="animate-spin" aria-hidden />}
      {m.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <span className="text-xs text-fg-subtle">Unclassified</span>;
  const m = SEVERITY_META[severity];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
