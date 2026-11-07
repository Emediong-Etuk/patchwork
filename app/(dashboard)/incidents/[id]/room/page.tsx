"use client";
import { use } from "react";
import { useIncident } from "@/src/client/use-incident";
import { ApiError } from "@/src/client/api";
import { IncidentHeader } from "@/components/incidents/incident-header";
import { CollaborationRoom } from "@/components/collaboration/room";
import { Callout, Skeleton } from "@/components/ui/misc";

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading, stream } = useIncident(id);
  if (isLoading) return <div className="p-6"><Skeleton className="h-[70vh]" /></div>;
  if (error || !data) return <div className="p-6"><Callout tone="danger" title="Could not load this room">{(error as ApiError)?.message}</Callout></div>;
  return (
    <div>
      <IncidentHeader d={data} room />
      <div className="p-6">
        <CollaborationRoom d={data} events={stream.events.length ? stream.events : data.events} state={stream.state} />
      </div>
    </div>
  );
}
