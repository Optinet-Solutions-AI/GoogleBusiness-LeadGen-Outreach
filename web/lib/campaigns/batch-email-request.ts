/**
 * campaigns/batch-email-request.ts — what the "Email this batch" window sends (zod).
 *
 * Inputs:  GET query (?eu=1&choices=<json>) and the POST body of /api/batches/:id/email
 * Outputs: parseChoices(raw) · startBatchEmailBody
 * Used by: app/api/batches/[id]/email/route.ts
 */
import { z } from "zod";

const choice = z.string().regex(/^(auto|saved:[0-9a-f-]{36})$/);
export const choicesSchema = z.record(z.string().max(40), choice).default({});

/** The per-offer email choices from a query string (bad JSON or values = none). */
export function parseChoices(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const r = choicesSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : {};
  } catch {
    return {};
  }
}

export const startBatchEmailBody = z.object({
  dailyLimit: z.number().int().min(1, "At least 1 email a day").max(100, "At most 100 emails a day"),
  followUps: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  includeEu: z.boolean(),
  choices: choicesSchema,
});
