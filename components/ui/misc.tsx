import type { ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/src/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-soft-pulse rounded-md bg-surface-3", className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 rounded-lg border border-border bg-surface-2 p-2.5 text-fg-subtle [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const styles = { info: "border-info/30 bg-info-soft text-info", warning: "border-warning/30 bg-warning-soft text-warning", danger: "border-danger/30 bg-danger-soft text-danger" }[tone];
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-xs", styles, className)}>
      <Icon className="mt-px size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1 text-fg-muted">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-3 px-1 font-mono text-[10px] text-fg-muted">{children}</kbd>;
}

export function StatusDot({ tone, pulse }: { tone: "success" | "warning" | "danger" | "neutral" | "accent" | "info"; pulse?: boolean }) {
  const c = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-fg-subtle", accent: "bg-accent", info: "bg-info" }[tone];
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", c, pulse && "animate-soft-pulse")} aria-hidden />;
}
