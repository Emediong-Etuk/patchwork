import { EventEmitter } from "events";
import type { ActivityEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import type { EventType, StreamEvent } from "./types";

const g = globalThis as unknown as { __patchworkBus?: EventEmitter };
const bus = g.__patchworkBus ?? new EventEmitter();
bus.setMaxListeners(1000);
g.__patchworkBus = bus;

export function toStreamEvent(e: ActivityEvent): StreamEvent {
  return {
    seq: e.seq.toString(),
    id: e.id,
    incidentId: e.incidentId,
    workspaceId: e.workspaceId,
    actorType: e.actorType,
    actorId: e.actorId,
    eventType: e.eventType as EventType,
    description: e.description,
    metadata: (e.metadata ?? {}) as Record<string, unknown>,
    createdAt: e.createdAt.toISOString(),
  };
}

export type EmitInput = {
  incidentId?: string | null;
  workspaceId?: string | null;
  actorType: "AGENT" | "USER" | "SYSTEM";
  actorId?: string | null;
  eventType: EventType;
  description: string;
  metadata?: Record<string, unknown>;
};

/** Persist first, then broadcast. A failed write never broadcasts. */
export async function emitEvent(input: EmitInput): Promise<StreamEvent> {
  const row = await db.activityEvent.create({
    data: {
      incidentId: input.incidentId ?? null,
      workspaceId: input.workspaceId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      eventType: input.eventType,
      description: input.description,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  const ev = toStreamEvent(row);
  bus.emit("event", ev);
  return ev;
}

export function subscribe(listener: (e: StreamEvent) => void): () => void {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}
