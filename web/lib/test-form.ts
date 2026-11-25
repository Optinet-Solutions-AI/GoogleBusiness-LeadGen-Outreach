/**
 * test-form.ts — the RateUp test contact form's messages (migration 071).
 *
 * Inputs:  a submitted message (name, email, phone, subject, message) / nothing for the list
 * Outputs: a row in test_form_messages / the latest 50 messages ({ missing: true } before 071)
 * Used by: app/api/test-form/route.ts (the form posts here), app/(dashboard)/test-form-received/page.tsx
 *
 * /test-form exists so the AI contact-form sender and QA can be tested without touching a real business.
 */
import "@/lib/server-guard";
import { z } from "zod";
import { getDb } from "@/lib/db";

export const TestFormInput = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.string().trim().email("Please enter a valid email").max(200),
  phone: z.string().trim().max(40).default(""),
  subject: z.string().trim().max(300).default(""),
  message: z.string().trim().min(1, "Please write a message").max(5000),
});
export type TestFormMessage = z.infer<typeof TestFormInput> & { id: string; created_at: string };

const missing = (m: string | undefined) => /test_form_messages/.test(m ?? "") && /does not exist|could not find|schema cache/i.test(m ?? "");
export const MISSING_071 = "The test form needs database update 071 (run db/migrations/071_test_form.sql in Supabase).";

export async function saveTestFormMessage(input: z.infer<typeof TestFormInput>): Promise<void> {
  const { error } = await getDb().from("test_form_messages").insert(input);
  if (error) throw new Error(missing(error.message) ? MISSING_071 : error.message);
}

export async function listTestFormMessages(): Promise<{ messages: TestFormMessage[]; missing: boolean }> {
  const { data, error } = await getDb()
    .from("test_form_messages")
    .select("id,name,email,phone,subject,message,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (missing(error.message)) return { messages: [], missing: true };
    throw new Error(error.message);
  }
  return { messages: (data ?? []) as TestFormMessage[], missing: false };
}
