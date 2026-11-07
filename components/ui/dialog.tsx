"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/src/utils/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, children, className, side }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string; side?: "center" | "right" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed z-50 border border-border bg-surface shadow-2xl focus:outline-none",
          side === "right" ? "inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-y-0 border-r-0" : "left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <D.Title className="text-sm font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-xs text-fg-subtle">{description}</D.Description> : <D.Description className="sr-only">Dialog</D.Description>}
          </div>
          <D.Close className="rounded p-1 text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
