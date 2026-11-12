/**
 * email/translate-copy.ts — translate the first email (as the operator edited it) into the lead's language.
 *
 * Inputs:  lead id; { subject, body } plain text
 * Outputs: { subject, body, language } plain text, or { error } in plain words. One Gemini call.
 * Used by: app/api/leads/[id]/sequence/translate/route.ts
 *
 * The operator sees the translation in the preview and approves it; approved wording is never re-translated.
 */
import "@/lib/server-guard";
import { getDb } from "@/lib/db";
import { renderSequenceEmail, htmlToPlain } from "@/lib/email/sequence-templates";
import { resolveLanguageCode, languageName, translateOutreachEmail } from "@/lib/services/gemini";
import type { StepCopy } from "@/lib/email/sequence-preview";

export async function translateFirstEmail(
  leadId: string,
  copy: StepCopy,
): Promise<(StepCopy & { language: string }) | { error: string }> {
  const { data } = await getDb()
    .from("leads")
    .select("business_name,demo_url,call_segment,language_code,country_code")
    .eq("id", leadId)
    .maybeSingle();
  if (!data) return { error: "Lead not found" };
  const lead = data as { business_name: string; demo_url: string | null; call_segment: string | null; language_code: string | null; country_code: string | null };
  const code = resolveLanguageCode(lead.language_code, lead.country_code);
  const language = languageName(code);
  if (!language) return { error: "This lead's language is English (or one we can't translate to)." };
  const html = renderSequenceEmail(lead, 1, copy).html;
  const out = await translateOutreachEmail({ subject: copy.subject, html, targetLangCode: code });
  if (!out) return { error: `Couldn't translate to ${language} right now (Gemini unavailable). Try again, or send in English.` };
  return { subject: out.subject.trim(), body: htmlToPlain(out.html), language };
}
