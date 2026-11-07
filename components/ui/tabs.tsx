"use client";
import * as T from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/src/utils/cn";

export const Tabs = T.Root;
export function TabsList({ className, ...p }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex items-center gap-1 border-b border-border px-2", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: ComponentProps<typeof T.Trigger>) {
  return <T.Trigger className={cn("-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-2.5 py-2 text-xs font-medium text-fg-subtle transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-3.5", className)} {...p} />;
}
export const TabsContent = T.Content;
