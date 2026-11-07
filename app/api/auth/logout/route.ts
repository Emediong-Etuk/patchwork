import { clearSessionCookie } from "@/src/lib/auth/session";
import { json, route } from "@/src/lib/http";

export const POST = route(async () => {
  await clearSessionCookie();
  return json({ ok: true });
});
