/**
 * brain/request.ts — the bodies the Brain's API routes accept (zod). Pure.
 *
 * Inputs:  the request JSON
 * Outputs: createBody · patchBody · approveBody · controlBody
 * Used by: app/api/brain/jobs/** (route files may only export handlers, so the schemas live here)
 */
import { z } from "zod";

export const createBody = z.object({
  command: z.string().trim().min(3, "Type what you want me to do").max(500, "Keep it under 500 characters"),
});

export const patchBody = z.discriminatedUnion("action", [
  // The operator answered the missing question, or picked the batch from the list.
  z.object({ action: z.literal("refine"), missing: z.string().trim().max(200).optional(), batchId: z.string().uuid().optional() }),
  // The settings (cleaned and clamped in lib/brain/rules.ts): start the search / the planning.
  z.object({ action: z.literal("start"), settings: z.unknown() }),
]);

const channel = z.enum(["email", "form", "call"]);

export const approveBody = z.object({
  rows: z
    .array(z.object({ leadId: z.string().uuid(), approved: z.boolean(), channels: z.array(channel).max(3), offer: z.string().max(40).nullable() }))
    .min(1)
    .max(300),
});

export const controlBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("raise_budget"), budgetUsd: z.number().positive().max(500) }),
]);
