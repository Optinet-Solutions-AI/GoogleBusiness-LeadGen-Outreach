/**
 * email/template-library.ts — saved email templates with a full version history (19 Nov 2026, migration 064).
 *
 * Inputs:  template inputs (name, offer, subject, body, up to three follow-ups each with its own subject — 070)
 *          from the Templates page / Send email window
 * Outputs: rows in email_templates (current version) + one email_template_versions row per save; archive instead of
 *          delete; restore = save an old version's content as the next version. Before migration 064 the reads return
 *          an empty list with `missing: true` and writes fail with a plain message. Before 070 the third follow-up and
 *          the follow-up subjects are dropped on save and read back empty.
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
  // Migration 070 (25 Nov 2026): a third follow-up, and each follow-up's own subject ("" = "Re: <subject>").
  follow_up_3: z.string().trim().max(5000).default(""),
  follow_up_subject_1: z.string().trim().max(200).default(""),
  follow_up_subject_2: z.string().trim().max(200).default(""),
  follow_up_subject_3: z.string().trim().max(200).default(""),
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
/** A saved version as read: one saved before migration 070 may lack the new follow-up fields. */
type VersionRow = Omit<TemplateVersion, (typeof NEW_FU)[number]> & Partial<Pick<TemplateVersion, (typeof NEW_FU)[number]>>;

export function restorePatch(versions: VersionRow[], v: number): { input: TemplateInput; note: string } | null {
  const found = versions.find((x) => x.version === v);
  if (!found) return null;
  const f = withFollowUpDefaults(found);
  const { name, service_key, subject, body, follow_up_1, follow_up_2 } = found;
  return {
    input: {
      name, service_key, subject, body, follow_up_1, follow_up_2,
      follow_up_3: f.follow_up_3, follow_up_subject_1: f.follow_up_subject_1,
      follow_up_subject_2: f.follow_up_subject_2, follow_up_subject_3: f.follow_up_subject_3,
    },
    note: `restored from version ${v}`,
  };
}

/** The follow-up columns migration 070 added. */
const NEW_FU = ["follow_up_3", "follow_up_subject_1", "follow_up_subject_2", "follow_up_subject_3"] as const;
const missingNewFu = (message: string | undefined) => NEW_FU.some((c) => (message ?? "").includes(c));

/** A save before migration 070: everything except the new follow-up columns. Pure. */
export function withoutNewFollowUps<T extends Record<string, unknown>>(input: T): Omit<T, (typeof NEW_FU)[number]> {
  const out: Record<string, unknown> = { ...input };
  for (const c of NEW_FU) delete out[c];
  return out as Omit<T, (typeof NEW_FU)[number]>;
}

/** A row read before migration 070 (or an older version): the new follow-up fields as "". Pure. */
export function withFollowUpDefaults<T extends object>(row: T): T & Record<(typeof NEW_FU)[number], string> {
  const r = row as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  for (const c of NEW_FU) out[c] = typeof r[c] === "string" ? r[c] : "";
  return out as T & Record<(typeof NEW_FU)[number], string>;
}

function isMissingTable(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("email_template") && (m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache"));
}

const COLS_064 = "id,name,service_key,subject,body,follow_up_1,follow_up_2,version,archived,created_at,updated_at";
const COLS = `${COLS_064},${NEW_FU.join(",")}`;
const VERSION_COLS_064 = "version,name,service_key,subject,body,follow_up_1,follow_up_2,note,created_at";

/** Run a select with the 070 columns; before 070, again without them (rows get them as ""). */
async function selectRows<T>(run: (cols: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>, cols070: string, cols064: string) {
  let r = await run(cols070);
  if (r.error && missingNewFu(r.error.message)) r = await run(cols064);
  return r as { data: T | null; error: { message: string } | null };
}

/** Run a write with the 070 columns; before 070, again without them. */
async function writeRow<T>(run: (values: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>, values: Record<string, unknown>, cols: (c: string) => void) {
  let r = await run(values);
  if (r.error && missingNewFu(r.error.message)) {
    cols(COLS_064);
    r = await run(withoutNewFollowUps(values));
  }
  return r as { data: T | null; error: { message: string } | null };
}

export async function listTemplates(opts: { includeArchived?: boolean } = {}): Promise<{ templates: EmailTemplate[]; missing: boolean }> {
  const { data, error } = await selectRows<EmailTemplate[]>(
    (cols) => {
      let q = getDb().from("email_templates").select(cols).order("updated_at", { ascending: false });
      if (!opts.includeArchived) q = q.eq("archived", false);
      return q;
    },
    COLS,
    COLS_064,
  );
  if (error) {
    if (isMissingTable(error.message)) return { templates: [], missing: true };
    throw new Error(error.message);
  }
  return { templates: (data ?? []).map(withFollowUpDefaults), missing: false };
}

export async function getTemplate(id: string): Promise<EmailTemplate | null> {
  const { data, error } = await selectRows<EmailTemplate>((cols) => getDb().from("email_templates").select(cols).eq("id", id).maybeSingle(), COLS, COLS_064);
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  return data ? withFollowUpDefaults(data) : null;
}

async function saveVersion(templateId: string, version: number, input: TemplateInput, note: string | null): Promise<void> {
  const { error } = await writeRow(
    (values) => getDb().from("email_template_versions").insert(values),
    { template_id: templateId, version, ...input, note },
    () => undefined,
  );
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
}

export async function createTemplate(input: TemplateInput): Promise<EmailTemplate> {
  let cols = COLS;
  const { data, error } = await writeRow<EmailTemplate>(
    (values) => getDb().from("email_templates").insert(values).select(cols).single(),
    { ...input, version: 1 },
    (c) => (cols = c),
  );
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  const t = withFollowUpDefaults(data as EmailTemplate);
  await saveVersion(t.id, 1, input, null);
  log.info({ template_id: t.id, name: t.name }, "email_template.created");
  return t;
}

export async function listVersions(id: string): Promise<TemplateVersion[]> {
  const { data, error } = await selectRows<TemplateVersion[]>(
    (cols) => getDb().from("email_template_versions").select(cols).eq("template_id", id).order("version", { ascending: false }),
    `${VERSION_COLS_064},${NEW_FU.join(",")}`,
    VERSION_COLS_064,
  );
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  return (data ?? []).map(withFollowUpDefaults);
}

/** Save new content as the next version (the old one stays in the history). */
export async function updateTemplate(id: string, input: TemplateInput, note: string | null = null): Promise<EmailTemplate> {
  const versions = await listVersions(id);
  const version = nextVersion(versions.map((v) => v.version));
  await saveVersion(id, version, input, note);
  let cols = COLS;
  const { data, error } = await writeRow<EmailTemplate>(
    (values) => getDb().from("email_templates").update(values).eq("id", id).select(cols).single(),
    { ...input, version, updated_at: new Date().toISOString() },
    (c) => (cols = c),
  );
  if (error) throw new Error(error.message);
  log.info({ template_id: id, version }, "email_template.updated");
  return withFollowUpDefaults(data as EmailTemplate);
}

export async function archiveTemplate(id: string, archived: boolean): Promise<EmailTemplate> {
  const { data, error } = await selectRows<EmailTemplate>(
    (cols) => getDb().from("email_templates").update({ archived, updated_at: new Date().toISOString() }).eq("id", id).select(cols).single(),
    COLS,
    COLS_064,
  );
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_064 : error.message);
  return withFollowUpDefaults(data as EmailTemplate);
}

export async function restoreVersion(id: string, version: number): Promise<EmailTemplate | null> {
  const patch = restorePatch(await listVersions(id), version);
  if (!patch) return null;
  return updateTemplate(id, patch.input, patch.note);
}
