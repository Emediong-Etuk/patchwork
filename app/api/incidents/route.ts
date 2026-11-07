import { requireUser } from "@/src/lib/auth/session";
import { json, parseBody, route } from "@/src/lib/http";
import { createIncidentSchema } from "@/src/schemas/incident";
import { createIncident, listIncidents } from "@/src/services/incidents";

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const p = new URL(req.url).searchParams;
  const incidents = await listIncidents(user.id, { workspaceId: p.get("workspaceId") ?? undefined, repositoryId: p.get("repositoryId") ?? undefined, status: p.get("status") ?? undefined });
  return json({ incidents });
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const input = await parseBody(req, createIncidentSchema);
  return json({ incident: await createIncident(user, input) }, 201);
});
