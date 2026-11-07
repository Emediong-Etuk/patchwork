"use client";
import { useActivity } from "@/src/client/hooks";
import { useWorkspace } from "@/src/client/workspace-context";
import { useEventStream } from "@/src/client/use-event-stream";
import { PageHeader } from "@/components/layout/app-shell";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/misc";

export default function ActivityPage() {
  const { workspaceId } = useWorkspace();
  const activity = useActivity(200);
  const stream = useEventStream(workspaceId ? `/api/events?workspaceId=${workspaceId}` : null, { invalidate: [["activity"]] });
  return (
    <div>
      <PageHeader
        title="Activity"
        description="Everything that happened in this workspace, newest first. Persisted before it is broadcast."
        actions={<span className="flex items-center gap-1.5 text-xs text-fg-subtle"><StatusDot tone={stream.state === "live" ? "success" : "warning"} pulse={stream.state !== "live"} /> {stream.state === "live" ? "Live" : "Connecting"}</span>}
      />
      <div className="p-6">
        <Card>
          <ActivityFeed events={activity.data} loading={activity.isLoading} />
        </Card>
      </div>
    </div>
  );
}
