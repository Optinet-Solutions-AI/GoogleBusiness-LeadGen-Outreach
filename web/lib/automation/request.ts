/**
 * automation/request.ts — what the automation screens send (zod).
 *
 * Inputs:  POST /api/batch-schedules · PATCH /api/batch-schedules/:id
 * Outputs: addScheduleBody · patchScheduleBody
 * Used by: app/api/batch-schedules/**
 */
import { z } from "zod";

export const addScheduleBody = z.object({
  niche: z.string().trim().min(2, "Type a niche (e.g. plumber)").max(80),
  city: z.string().trim().min(2, "Type a city (e.g. Austin, TX)").max(120),
  country_code: z.string().trim().toLowerCase().regex(/^[a-z]{2}$/, "Country: two letters, e.g. us").default("us"),
});

export const patchScheduleBody = z.object({ active: z.boolean() });
