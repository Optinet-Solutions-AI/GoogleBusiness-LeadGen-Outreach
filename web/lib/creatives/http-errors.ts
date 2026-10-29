/**
 * http-errors.ts — maps Creative Studio library errors to API responses.
 *
 * Inputs:  a thrown value
 * Outputs: a fail() response (400/404/409/422) or the original error rethrown for withApi (500)
 * Used by: app/api/clients/[id]/plans*, app/api/clients/[id]/creatives*
 */
import "@/lib/server-guard";
import { ZodError } from "zod";
import { fail } from "@/lib/response";
import { NotFoundError, VersionConflictError } from "@/lib/clients/profile";
import { ReviewError } from "./creatives";
import { CreativeBusyError } from "./generate";
import { PlanStateError } from "./plans";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when every id is a well-formed uuid (a malformed id would otherwise 500 inside Postgres). */
export const allUuids = (...ids: string[]): boolean => ids.every((i) => UUID.test(i));

export function mapCreativeError(err: unknown) {
  if (err instanceof ZodError) {
    const i = err.issues[0];
    const path = i?.path.join(".");
    return fail(i ? `${path ? `${path}: ` : ""}${i.message}` : "Invalid input", 400);
  }
  if (err instanceof NotFoundError) return fail(err.message, 404);
  if (err instanceof PlanStateError) return fail(err.message, 409);
  if (err instanceof ReviewError) return fail(err.message, 422);
  if (err instanceof VersionConflictError) return fail(err.message, 409);
  if (err instanceof CreativeBusyError) return fail(err.message, 409);
  throw err;
}
