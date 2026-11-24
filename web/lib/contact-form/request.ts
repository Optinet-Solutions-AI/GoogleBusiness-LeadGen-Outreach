/**
 * contact-form/request.ts — the body POST /api/leads/:id/contact-form accepts (zod). Pure.
 *
 * Inputs:  the request JSON
 * Outputs: contactFormBody — { action: "look", force? } | { action: "send", runId, senderEmail?, subject, message, offerKey? }
 *          | { action: "manual", runId, subject, message, offerKey? } (sent by hand: CAPTCHA hand-off)
 * Used by: app/api/leads/[id]/contact-form/route.ts (route files may only export handlers, so the schema lives here)
 */
import { z } from "zod";

export const contactFormBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("look"), force: z.boolean().optional() }),
  z.object({
    action: z.literal("send"),
    runId: z.string().uuid(),
    senderEmail: z.string().email().optional(),
    subject: z.string().trim().max(300, "Subject is too long (300 characters max)"),
    message: z.string().trim().min(1, "Write a message first").max(5000, "Message is too long (5,000 characters max)"),
    offerKey: z.string().max(60).optional(),
  }),
  // CAPTCHA hand-off (24 Nov 2026): the operator pasted the message into their protected form and sent it themselves.
  z.object({
    action: z.literal("manual"),
    runId: z.string().uuid(),
    subject: z.string().trim().max(300, "Subject is too long (300 characters max)"),
    message: z.string().trim().min(1, "Write a message first").max(5000, "Message is too long (5,000 characters max)"),
    offerKey: z.string().max(60).optional(),
  }),
]);

export type ContactFormBody = z.infer<typeof contactFormBody>;
