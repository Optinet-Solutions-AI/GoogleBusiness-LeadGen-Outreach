/**
 * email/template-library.ts — saved email templates with a full version history (19 Nov 2026, migration 064).
 *
 * Inputs:  template inputs (name, offer, subject, body, two follow-ups) from the Templates page / Send email window
 * Outputs: rows in email_templates (current version) + one email_template_versions row per save; archive instead of
 *          delete; restore = save an old version's content as the next version. Before migration 064 the reads return
 *          an empty list with `missing: true` and writes fail with a plain message.
 * Used by: app/api/email-templates/** (Templates page, Send email "Saved" templates + "Save as template")
 */
import "@/lib/server-guard";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const log = getLogger("email.templates");

export const TemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** The offer it's written for (a Send email service key); null = any offer. */
  service_key: z.string().trim().min(1).max(40).nullable().default(null),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  follow_up_1: z.string().trim().max(5000).default(""),
  follow_up_2: z.string().trim().max(5000).default(""),
});
export type TemplateInput = z.infer<typeof TemplateInputSchema>;

export interface EmailTemplate extends TemplateInput {
  id: string;
  version: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersion extends TemplateInput {
  version: number;
  note?: string | null;
  created_at?: string;
}

export const MISSING_064 = "Saved templates need database update 064 (run db/migrations/064_templates_agents.sql in Supabase).";

/** One above the highest saved version; 1 for a new template. Pure. */
export function nextVersion(existing: number[]): number {
  return existing.length ? Math.max(...existing) + 1 : 1;
}

/** The content of version `v`, to be saved as the next version, or null when there is no such version. Pure. */
export function restorePatch(versions: TemplateVersion[], v: number): { input: TemplateInput; note: string } | null {
  const found = versions.find((x) => x.version === v);
  if (!found) return null;
  const { name, service_key, subject, body, follow_up_1, follow_up_2 } = found;
  return { input: { name, service_key, subject, body, follow_up_1, follow_up_2 }, note: `restored from version ${v}` };
}

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("email_template") && (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

const COLS = "id,name,service_key,subject,body,follow_up_1,follow_up_2,version,archived,created_at,updated_at";

export async function listTemplates(opts: { includeArchived?: boolean } = {}): Promise<{ templates: EmailTemplate[]; missing: boolean }> {
  let q = getDb().from("email_templates").select(COLS).order("updated_at", { ascending: false });
  if (!opts.includeArchived) q = q.eq("archived", false);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error.message)) return { templates: [], missing: true };
    throw new Error(error.message);
  }
  return { templates: (data ?? []) as EmailTemplate[], missing: false };
}

export async function getTemplate(id: string): Promise<EmailTemplate | null> {
  const { data, error } = await getDb().from("email_templates").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  return (data as EmailTemplate | null) ?? null;
}

async function saveVersion(templateId: string, version: number, input: TemplateInput, note: string | null): Promise<void> {
  const { error } = await getDb().from("email_template_versions").insert({ template_id: templateId, version, ...input, note });
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
}

export async function createTemplate(input: TemplateInput): Promise<EmailTemplate> {
  const { data, error } = await getDb().from("email_templates").insert({ ...input, version: 1 }).select(COLS).single();
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  const t = data as EmailTemplate;
  await saveVersion(t.id, 1, input, null);
  log.info({ template_id: t.id, name: t.name }, "email_template.created");
  return t;
}

export async function listVersions(id: string): Promise<TemplateVersion[]> {
  const { data, error } = await getDb()
    .from("email_template_versions")
    .select("version,name,service_key,subject,body,follow_up_1,follow_up_2,note,created_at")
    .eq("template_id", id)
    .order("version", { ascending: false });
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  return (data ?? []) as TemplateVersion[];
}

/** Save new content as the next version (the old one stays in the history). */
export async function updateTemplate(id: string, input: TemplateInput, note: string | null = null): Promise<EmailTemplate> {
  const versions = await listVersions(id);
  const version = nextVersion(versions.map((v) => v.version));
  await saveVersion(id, version, input, note);
  const { data, error } = await getDb()
    .from("email_templates")
    .update({ ...input, version, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  log.info({ template_id: id, version }, "email_template.updated");
  return data as EmailTemplate;
}

export async function archiveTemplate(id: string, archived: boolean): Promise<EmailTemplate> {
  const { data, error } = await getDb()
    .from("email_templates")
    .update({ archived, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  return data as EmailTemplate;
}

export async function restoreVersion(id: string, version: number): Promise<EmailTemplate | null> {
  const patch = restorePatch(await listVersions(id), version);
  if (!patch) return null;
  return updateTemplate(id, patch.input, patch.note);
}
