/**
 * email/sequence-preview.ts — the exact wording a lead will get, step by step, for the Send email preview. Pure.
 *
 * Inputs:  a lead ({ business_name, demo_url, call_segment }), the campaign's copy style + per-step overrides
 * Outputs: plain-text { subject, body } per step with spintax resolved and the business name filled in,
 *          plus small display helpers (day offsets, token placeholders)
 * Used by: lib/email/load-email-preview.ts (server) and components/outreach/EmailPreviewModal.tsx
 *
 * The approved step-1 text is saved on the lead (leads.seq_copy_overrides) and sent exactly as shown, so the
 * random greeting variant ({Hi there|Hello}) is picked HERE, once, not again at send time.
 * {{demo_link}} and {{screenshot}} stay as tokens in the editable text; the sender swaps them for the live link
 * and the inline screenshot.
 */
import { resolveSpintax } from "../services/spintax";
import {
  defaultEditableCopy,
  maxStepForVariant,
  variantFor,
  type SeqCopyOverride,
  type SeqLead,
  type SeqStep,
  type SeqStyle,
} from "./sequence-templates";

export interface StepCopy {
  subject: string;
  body: string;
}

/** Days after the first email that each step goes out (the sequence waits 4 days between steps). */
export const STEP_GAP_DAYS = 4;
export function stepDay(step: number): number {
  return (step - 1) * STEP_GAP_DAYS;
}

function fillNames(text: string, rawName: string): string {
  const first = (rawName.split(/\s+/)[0] || "there").trim();
  return text
    .replace(/\{\{\s*business_name\s*\}\}/gi, rawName)
    .replace(/\{\{\s*first_name\s*\}\}/gi, first);
}

const blank = (s: string | null | undefined) => !s || !s.trim();

/** Fill the names, pick one wording variant per {a|b} group, and keep {{demo_link}} / {{screenshot}} intact. */
function resolveText(text: string, rawName: string): string {
  const kept: string[] = [];
  const shielded = text.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, (t) => {
    kept.push(t);
    return `\u0000${kept.length - 1}\u0000`;
  });
  const resolved = resolveSpintax(shielded).replace(/\u0000(\d+)\u0000/g, (_m, i) => kept[Number(i)]);
  // Names go in last, so a business name with "{" or "|" in it is never read as a wording variant.
  return fillNames(resolved, rawName).trim();
}

/** One step's wording for this lead: campaign override (if any) else the default for the style. Null past the last step. */
export function stepCopy(
  lead: SeqLead,
  step: SeqStep,
  style: SeqStyle = "friendly",
  override?: SeqCopyOverride | null,
): StepCopy | null {
  const def = defaultEditableCopy(variantFor(lead.call_segment), step, style);
  if (!def) return null;
  const subject = blank(override?.subject) ? def.subject : override!.subject!;
  const body = blank(override?.body) ? def.body : override!.body!;
  return {
    subject: resolveText(subject, lead.business_name),
    body: resolveText(body, lead.business_name),
  };
}

/** Every step this lead would get, in order (2 for the AI-services pitch, 4 otherwise). */
export function allSteps(
  lead: SeqLead,
  style: SeqStyle = "friendly",
  overrides?: Record<string, SeqCopyOverride | null | undefined> | null,
): { step: SeqStep; day: number; copy: StepCopy }[] {
  const max = maxStepForVariant(variantFor(lead.call_segment));
  const out: { step: SeqStep; day: number; copy: StepCopy }[] = [];
  for (let s = 1; s <= max; s++) {
    const step = s as SeqStep;
    const copy = stepCopy(lead, step, style, overrides?.[String(s)] ?? null);
    if (copy) out.push({ step, day: stepDay(s), copy });
  }
  return out;
}

/** Body as the reader sees it: tokens shown as what they become. */
export function displayBody(body: string, demoUrl: string | null | undefined): string {
  return body
    .replace(/\{\{\s*demo_link\s*\}\}/gi, demoUrl || "(the live demo link)")
    .replace(/\{\{\s*screenshot\s*\}\}/gi, "[ screenshot of their demo site ]");
}

/** Did the operator change the wording we proposed? Whitespace-only edits don't count. */
export function isEdited(proposed: StepCopy, approved: StepCopy): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(proposed.subject) !== norm(approved.subject) || norm(proposed.body) !== norm(approved.body);
}
