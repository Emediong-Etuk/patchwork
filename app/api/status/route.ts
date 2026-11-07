import { requireUser } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";
import { systemStatus } from "@/src/services/status";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireUser();
  return json(await systemStatus());
});
