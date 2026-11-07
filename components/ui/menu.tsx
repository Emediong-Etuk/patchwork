"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/src/utils/cn";

/** Minimal accessible dropdown: toggles on click, closes on outside click / Escape. */
export function Menu({ trigger, children, align = "right", className, label }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className="flex items-center">
        {trigger(open)}
      </button>
      {open && (
        <div role="menu" className={cn("absolute top-full z-40 mt-1.5 min-w-56 rounded-md border border-border bg-surface-2 p-1 shadow-2xl", align === "right" ? "right-0" : "left-0", className)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onSelect, children, active }: { onSelect: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onSelect} className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-surface-3 hover:text-fg [&_svg]:size-4", active && "text-fg")}>
      {children}
    </button>
  );
}
