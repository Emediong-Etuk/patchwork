import { Compass, Search, ShieldCheck, Wrench, User, Radio } from "lucide-react";
import { AGENT_META } from "@/src/client/display";
import { cn } from "@/src/utils/cn";

const ICONS = { TRIAGE: Compass, INVESTIGATOR: Search, FIXER: Wrench, QA: ShieldCheck } as const;

export function AgentAvatar({ role, size = "md", human, system }: { role?: string | null; size?: "sm" | "md" | "lg"; human?: boolean; system?: boolean }) {
  const dims = { sm: "size-6 [&_svg]:size-3", md: "size-8 [&_svg]:size-4", lg: "size-10 [&_svg]:size-5" }[size];
  if (human) return <span className={cn("flex shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-3 text-fg", dims)}><User aria-hidden /></span>;
  if (system || !role || !(role in ICONS)) return <span className={cn("flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-subtle", dims)}><Radio aria-hidden /></span>;
  const Icon = ICONS[role as keyof typeof ICONS];
  const m = AGENT_META[role];
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-md border", m.color, m.ring, m.text, dims)}>
      <Icon aria-hidden />
    </span>
  );
}
