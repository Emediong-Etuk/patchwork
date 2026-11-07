import type { IncidentStatus } from "@prisma/client";
import { db } from "@/src/lib/database/client";

/** Allowed incident transitions. Anything not listed is rejected. */
export const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  NEW: ["TRIAGING", "CANCELLED", "FAILED"],
  TRIAGING: ["INVESTIGATING", "NEEDS_INFORMATION", "FAILED", "BLOCKED", "CANCELLED"],
  NEEDS_INFORMATION: ["TRIAGING", "CANCELLED"],
  INVESTIGATING: ["FIXING", "NEEDS_INFORMATION", "BLOCKED", "FAILED", "CANCELLED"],
  FIXING: ["TESTING", "BLOCKED", "FAILED", "CANCELLED"],
  TESTING: ["AWAITING_APPROVAL", "FIXING", "BLOCKED", "FAILED", "CANCELLED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["RESOLVED"],
  REJECTED: ["FIXING", "CANCELLED"],
  BLOCKED: ["FIXING", "TRIAGING", "INVESTIGATING", "CANCELLED"],
  FAILED: ["TRIAGING", "INVESTIGATING", "FIXING", "TESTING", "CANCELLED"],
  RESOLVED: [],
  CANCELLED: [],
};

export const ACTIVE_STATUSES: IncidentStatus[] = ["TRIAGING", "INVESTIGATING", "FIXING", "TESTING"];
export const TERMINAL_STATUSES: IncidentStatus[] = ["RESOLVED", "CANCELLED"];

export class InvalidTransitionError extends Error {
  constructor(
    public from: IncidentStatus,
    public to: IncidentStatus,
  ) {
    super(`Invalid incident transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: IncidentStatus, to: IncidentStatus) {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: IncidentStatus, to: IncidentStatus) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Compare-and-set transition: succeeds only if the incident is still in one of
 * `from`. Concurrent or duplicate workflow steps therefore cannot both win.
 */
export async function transition(incidentId: string, from: IncidentStatus | IncidentStatus[], to: IncidentStatus, data: Record<string, unknown> = {}) {
  const froms = (Array.isArray(from) ? from : [from]).filter((f) => canTransition(f, to));
  if (!froms.length) throw new InvalidTransitionError(Array.isArray(from) ? from[0] : from, to);
  const res = await db.incident.updateMany({ where: { id: incidentId, status: { in: froms } }, data: { status: to, ...data } });
  return res.count === 1;
}
