import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type output } from "zod";
import { HttpError } from "@/src/lib/auth/session";

export function json<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON", "invalid_json");
  }
  return schema.parse(raw);
}

/** Wraps a route handler with uniform error responses. */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
      if (err instanceof ZodError)
        return json({ error: "Validation failed", code: "validation_error", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
      console.error("[patchwork] unhandled route error", err);
      return json({ error: "Internal server error", code: "internal_error" }, 500);
    }
  };
}
