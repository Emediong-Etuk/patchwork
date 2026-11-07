export const EVENT_TYPES = [
  "INCIDENT_CREATED",
  "INCIDENT_STATUS_CHANGED",
  "SWITCH_ROOM_CREATED",
  "SWITCH_ROOM_FAILED",
  "AGENT_JOINED_ROOM",
  "AGENT_MESSAGE",
  "HUMAN_MESSAGE",
  "AGENT_STATUS_CHANGED",
  "AGENT_TOOL_CALL",
  "SWITCH_HANDOFF_DELIVERED",
  "TASK_ASSIGNED",
  "TRIAGE_STARTED",
  "TRIAGE_COMPLETED",
  "INVESTIGATION_STARTED",
  "INVESTIGATION_COMPLETED",
  "EVIDENCE_ADDED",
  "FIX_STARTED",
  "CODE_CHANGED",
  "QA_STARTED",
  "TEST_STARTED",
  "TEST_COMPLETED",
  "FIX_FAILED",
  "FIX_PASSED",
  "APPROVAL_REQUESTED",
  "FIX_APPROVED",
  "FIX_REJECTED",
  "PULL_REQUEST_CREATED",
  "INCIDENT_RESOLVED",
  "INCIDENT_BLOCKED",
  "INCIDENT_FAILED",
  "INCIDENT_CANCELLED",
  "NEEDS_INFORMATION",
  "WORKFLOW_ERROR",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Wire shape of an event as streamed to the browser. */
export type StreamEvent = {
  seq: string;
  id: string;
  incidentId: string | null;
  workspaceId: string | null;
  actorType: "AGENT" | "USER" | "SYSTEM";
  actorId: string | null;
  eventType: EventType;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
