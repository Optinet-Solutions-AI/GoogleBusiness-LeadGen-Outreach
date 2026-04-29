/**
 * api-wrap.ts — `withApi(fn)` wraps a Next.js Route Handler so any thrown
 * error becomes a `{ success: false, error: "..." }` JSON envelope with the
 * appropriate HTTP status, instead of Next's default empty-body 500 (which
 * makes `await res.json()` blow up on the client).
 *
 * Use it on every POST/PATCH/DELETE handler. GET handlers that already use
 * `safeDb` don't strictly need it but are fine to wrap for consistency.
 *
 * Usage:
 *   export const POST = withApi(async (req, ctx) => { ... return ok(...) });
 */

import { NextResponse } from "next/server";
import { getLogger } from "./logger";

const log = getLogger("api");

type RouteCtx = { params: Record<string, string> };
type Handler = (req: Request, ctx: RouteCtx) => Promise<Response>;

export function withApi(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      // Pull a useful message off whatever was thrown
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "internal_error";
      log.error({ method: req.method, url: req.url, err: String(err) }, "api.throw");
      return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
  };
}
