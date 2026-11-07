import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <p className="text-sm text-fg-muted">That page doesn&apos;t exist.</p>
      <Button asChild variant="secondary" size="sm"><Link href="/dashboard">Back to the dashboard</Link></Button>
    </div>
  );
}
