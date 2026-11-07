import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { db } from "@/src/lib/database/client";
import { sign, verifySigned } from "@/src/lib/security/crypto";

export const SESSION_COOKIE = "pw_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function sessionToken(userId: string): string {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  return sign(`${userId}:${expires}`);
}

export function parseSessionToken(token: string | undefined): string | null {
  const value = verifySigned(token);
  if (!value) return null;
  const [userId, exp] = value.split(":");
  if (!userId || !exp || Number(exp) < Date.now() / 1000) return null;
  return userId;
}

export async function setSessionCookie(userId: string) {
  (await cookies()).set(SESSION_COOKIE, sessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https"),
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const userId = parseSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return db.user.findUnique({ where: { id: userId } });
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Sign in required", "unauthenticated");
  return user;
}

/** Throws 404 (not 403) for workspaces the user cannot see, to avoid leaking ids. */
export async function requireWorkspaceMember(userId: string, workspaceId: string) {
  const member = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) throw new HttpError(404, "Workspace not found", "not_found");
  return member;
}

export async function requireIncidentAccess(userId: string, incidentId: string) {
  const incident = await db.incident.findUnique({ where: { id: incidentId }, include: { repository: true } });
  if (!incident) throw new HttpError(404, "Incident not found", "not_found");
  await requireWorkspaceMember(userId, incident.workspaceId);
  return incident;
}
