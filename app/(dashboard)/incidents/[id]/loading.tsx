import { Skeleton } from "@/components/ui/misc";
export default function Loading() {
  return <div className="space-y-4 p-6"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
}
