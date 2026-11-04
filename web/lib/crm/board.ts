/**
 * crm/board.ts — the CRM board model: columns, which stages land in each, follow-up buckets. Pure.
 *
 * Inputs:  lead rows (stage, next_follow_up_at, tags, …) + "now"
 * Outputs: columns with their cards, follow-up counts, filter helpers
 * Used by: app/(dashboard)/crm/page.tsx (server) + components/crm/CrmBoard.tsx (client)
 *
 * No DB, no server imports — the client component imports this file too.
 */

export type CrmColumnKey =
  | "new"
  | "outreached"
  | "replied"
  | "meeting_booked"
  | "meeting_done"
  | "improved"
  | "handed_over"
  | "closed_won"
  | "lost";

export interface CrmColumn {
  key: CrmColumnKey;
  label: string;
  /** leads.stage values that belong in this column */
  stages: readonly string[];
  /** stage written when a card is dropped here; null = pipeline-owned, no drop */
  dropStage: string | null;
  tone: "neutral" | "action" | "urgent" | "warning" | "positive";
}

export const CRM_COLUMNS: readonly CrmColumn[] = [
  { key: "new", label: "Not contacted", stages: ["scraped", "enriched", "generated", "deployed", "needs_email"], dropStage: null, tone: "neutral" },
  { key: "outreached", label: "Contacted", stages: ["outreached"], dropStage: "outreached", tone: "action" },
  { key: "replied", label: "Replied", stages: ["replied"], dropStage: "replied", tone: "urgent" },
  { key: "meeting_booked", label: "Meeting booked", stages: ["meeting_booked"], dropStage: "meeting_booked", tone: "warning" },
  { key: "meeting_done", label: "Meeting done", stages: ["meeting_done"], dropStage: "meeting_done", tone: "warning" },
  { key: "improved", label: "Improving", stages: ["improved"], dropStage: "improved", tone: "action" },
  { key: "handed_over", label: "Handed over", stages: ["handed_over"], dropStage: "handed_over", tone: "positive" },
  { key: "closed_won", label: "Won", stages: ["closed_won"], dropStage: "closed_won", tone: "positive" },
  { key: "lost", label: "Lost", stages: ["closed_lost", "dead"], dropStage: "closed_lost", tone: "neutral" },
] as const;

/** How many "Not contacted" cards the board shows (the rest are on /leads). */
export const NEW_COLUMN_CAP = 40;

export interface CrmCard {
  id: string;
  business_name: string;
  stage: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  country_code: string | null;
  category: string | null;
  primary_offer: string | null;
  demo_url: string | null;
  screenshot_url: string | null;
  tags: string[];
  next_follow_up_at: string | null;
  assigned_to: string | null;
  updated_at: string;
  inbox_status: string | null;
  seq_status: string | null;
  call_status: string | null;
  setup_fee: number | null;
  monthly_amount: number | null;
}

export function columnForStage(stage: string): CrmColumn {
  return CRM_COLUMNS.find((c) => c.stages.includes(stage)) ?? CRM_COLUMNS[0];
}

export type FollowUpBucket = "overdue" | "today" | "week" | "later" | "none";

/** Which follow-up bucket a card is in, judged in the operator's local day (the `now` passed in). */
export function followUpBucket(iso: string | null, now: Date): FollowUpBucket {
  if (!iso) return "none";
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return "none";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 86_400_000);
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 86_400_000);
  if (due < startOfToday) return "overdue";
  if (due < startOfTomorrow) return "today";
  if (due < endOfWeek) return "week";
  return "later";
}

export interface FollowUpCounts {
  overdue: number;
  today: number;
  week: number;
}

export function countFollowUps(cards: readonly CrmCard[], now: Date): FollowUpCounts {
  const out: FollowUpCounts = { overdue: 0, today: 0, week: 0 };
  for (const c of cards) {
    const b = followUpBucket(c.next_follow_up_at, now);
    if (b === "overdue") out.overdue += 1;
    else if (b === "today") out.today += 1;
    else if (b === "week") out.week += 1;
  }
  return out;
}

export interface BoardFilters {
  q?: string;
  tag?: string;
  owner?: string;
  offer?: string;
  country?: string;
  due?: "overdue" | "today" | "week" | "any";
}

/** Case-insensitive match on name / email / phone / city, plus the exact-ish filters. Pure. */
export function filterCards(cards: readonly CrmCard[], f: BoardFilters, now: Date): CrmCard[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  const tag = f.tag?.trim().toLowerCase() ?? "";
  const owner = f.owner?.trim().toLowerCase() ?? "";
  const country = f.country?.trim().toLowerCase() ?? "";
  return cards.filter((c) => {
    if (q) {
      const hay = `${c.business_name} ${c.email ?? ""} ${c.phone ?? ""} ${c.address ?? ""} ${c.category ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (tag && !c.tags.some((t) => t.toLowerCase() === tag)) return false;
    if (owner && (c.assigned_to ?? "").toLowerCase() !== owner) return false;
    if (f.offer && c.primary_offer !== f.offer) return false;
    if (country && (c.country_code ?? "").toLowerCase() !== country) return false;
    if (f.due) {
      const b = followUpBucket(c.next_follow_up_at, now);
      if (f.due === "any" ? b === "none" || b === "later" : b !== f.due) return false;
    }
    return true;
  });
}

export interface BoardColumnView {
  column: CrmColumn;
  cards: CrmCard[];
  /** true count, including cards hidden by NEW_COLUMN_CAP */
  total: number;
  /** sum of monthly_amount for Won — shown in the column header */
  mrr: number;
}

/** Group filtered cards into columns. Cards are already sorted (most recently updated first). */
export function groupIntoColumns(cards: readonly CrmCard[]): BoardColumnView[] {
  return CRM_COLUMNS.map((column) => {
    const mine = cards.filter((c) => column.stages.includes(c.stage));
    const shown = column.key === "new" ? mine.slice(0, NEW_COLUMN_CAP) : mine;
    const mrr = mine.reduce((s, c) => s + (c.monthly_amount ?? 0), 0);
    return { column, cards: shown, total: mine.length, mrr };
  });
}

/** Normalise a tag list the way the API stores it: lower-case, trimmed, unique, max 10. */
export function normaliseTags(input: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of input) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
    if (t) seen.add(t);
    if (seen.size >= 10) break;
  }
  return [...seen];
}

/** Distinct values for the filter dropdowns. */
export function distinctValues(cards: readonly CrmCard[]): { tags: string[]; owners: string[]; countries: string[] } {
  const tags = new Set<string>();
  const owners = new Set<string>();
  const countries = new Set<string>();
  for (const c of cards) {
    for (const t of c.tags) tags.add(t);
    if (c.assigned_to) owners.add(c.assigned_to);
    if (c.country_code) countries.add(c.country_code.toLowerCase());
  }
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { tags: sort(tags), owners: sort(owners), countries: sort(countries) };
}
