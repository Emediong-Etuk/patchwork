import { cn } from "@/src/utils/cn";

/** Four tiles stitched into one square: four agents, one incident. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <rect x="2" y="2" width="9" height="9" rx="2" className="fill-warning" />
      <rect x="13" y="2" width="9" height="9" rx="2" className="fill-info" />
      <rect x="2" y="13" width="9" height="9" rx="2" className="fill-accent" />
      <rect x="13" y="13" width="9" height="9" rx="2" className="fill-success" />
      <path d="M11 6.5h2M17.5 11v2M11 17.5h2M6.5 11v2" className="stroke-fg-subtle" strokeWidth="1.2" strokeDasharray="1 1" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-[0.18em] text-fg", className)}>
      <LogoMark />
      <span className="text-[13px]">PATCHWORK</span>
    </span>
  );
}
