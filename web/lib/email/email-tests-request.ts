/**
 * email/email-tests-request.ts — what the Templates page sends to start or end a wording test (zod).
 *
 * Inputs:  the POST body of /api/email-tests and the PATCH body of /api/email-tests/:id
 * Outputs: startTestBody · endTestBody
 * Used by: app/api/email-tests/route.ts, app/api/email-tests/[id]/route.ts
 */
import { z } from "zod";

const emailKey = z.string().trim().regex(/^(service:[a-z_]+|saved:[0-9a-f-]{36})$/, "Pick an email");

export const startTestBody = z.object({
  service_key: z.string().trim().min(1, "Pick the offer to test").max(40),
  a_key: emailKey,
  b_key: emailKey,
});

export const endTestBody = z.object({ winner: z.enum(["A", "B"], { message: "Pick which version to keep" }) });
