"use client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/misc";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <Callout tone="danger" title="Something went wrong on this page">{error.message}</Callout>
      <Button className="mt-3" size="sm" onClick={reset}>Try again</Button>
    </div>
  );
}
