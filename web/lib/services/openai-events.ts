/**
 * openai-events.ts — find conferences / trade shows for a country + category + year with OpenAI web search.
 *
 * Inputs:  { country (ISO-2 or 'eu'), category, year, max }
 * Outputs: DiscoveredEvent[] — name, website, exhibitor-list / floor-plan pages, city, country, dates; usd spent
 * Used by: lib/services/exhibitors.ts when the operator pasted no conference links
 *
 * Same Responses-API shape as openai-contacts.ts (web_search tool + strict JSON schema). Paid: ≈ 5–10¢ a call.
 */
import "@/lib/server-guard";
import { env } from "@/lib/config";
import { getLogger } from "@/lib/logger";
import { retry } from "@/lib/retry";
import { failOpenAi, OpenAiUnavailableError, recordOpenAiResult, shouldRetryOpenAi } from "./openai-health";
import { lookupCostUsd } from "./openai-contacts";

const log = getLogger("openai-events");
const URL_RESPONSES = "https://api.openai.com/v1/responses";

export interface DiscoveredEvent {
  name: string;
  website: string | null;
  exhibitors_url: string | null;
  floor_plan_url: string | null;
  city: string | null;
  country: string | null;
  start_date: string | null;
  end_date: string | null;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          website: { type: ["string", "null"] },
          exhibitors_url: { type: ["string", "null"], description: "The page listing the exhibitors / sponsors with stands" },
          floor_plan_url: { type: ["string", "null"], description: "The interactive floor plan page (ExpoFP, Map Your Show…) if any" },
          city: { type: ["string", "null"] },
          country: { type: ["string", "null"], description: "ISO-2" },
          start_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
          end_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
        },
        required: ["name", "website", "exhibitors_url", "floor_plan_url", "city", "country", "start_date", "end_date"],
      },
    },
  },
  required: ["events"],
} as const;

export const COUNTRY_WORDS: Record<string, string> = { eu: "Europe", gb: "United Kingdom", de: "Germany", fr: "France", es: "Spain", it: "Italy", nl: "Netherlands", mt: "Malta", pt: "Portugal", ie: "Ireland", be: "Belgium", at: "Austria", ch: "Switzerland", pl: "Poland", cz: "Czechia", se: "Sweden", dk: "Denmark", no: "Norway", fi: "Finland", gr: "Greece", cy: "Cyprus", ro: "Romania", hu: "Hungary", hr: "Croatia", rs: "Serbia", bg: "Bulgaria", ee: "Estonia", lv: "Latvia", lt: "Lithuania", lu: "Luxembourg", si: "Slovenia", sk: "Slovakia", tr: "Turkey" };

/** The instruction for one discovery call. Pure. */
export function eventsPrompt(o: { country: string; category: string; year: number; max: number }): string {
  const where = COUNTRY_WORDS[o.country.toLowerCase()] ?? o.country.toUpperCase();
  const cat = o.category.trim().toLowerCase() === "any" ? "any industry" : o.category;
  return [
    `List up to ${o.max} conferences, expos or trade shows in ${where} held in ${o.year} (past or upcoming) where companies exhibit with booths / stands.`,
    `Category: ${cat}. Prefer the biggest shows with public exhibitor lists.`,
    `For each: the official website, the exact page listing exhibitors (or sponsors with stands), and the interactive floor plan page if the show has one`,
    `(many use expofp.com — a link like https://<event>.expofp.com is ideal). City, ISO-2 country, start and end dates.`,
    `Only real events you found on the web; null for anything you did not see. No event organisers' service pages, no ticket resellers.`,
  ].join("\n");
}

type ResponseBody = { output?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number } };

/** Pull the events out of the response and drop junk. Pure. */
export function parseEvents(body: ResponseBody): DiscoveredEvent[] {
  const text = (body.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
  let raw: { events?: Partial<DiscoveredEvent>[] } = {};
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const url = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v.trim()) ? v.trim() : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const seen = new Set<string>();
  const out: DiscoveredEvent[] = [];
  for (const e of raw.events ?? []) {
    const name = str(e.name);
    if (!name) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, website: url(e.website), exhibitors_url: url(e.exhibitors_url), floor_plan_url: url(e.floor_plan_url), city: str(e.city), country: str(e.country)?.toLowerCase().slice(0, 2) ?? null, start_date: date(e.start_date), end_date: date(e.end_date) });
  }
  return out;
}

export async function discoverEvents(o: { country: string; category: string; year: number; max?: number }): Promise<{ events: DiscoveredEvent[]; usd: number }> {
  if (!env.OPENAI_API_KEY.trim()) throw new OpenAiUnavailableError("missing", "OPENAI_API_KEY missing");
  const max = Math.min(o.max ?? 12, 25);
  const started = Date.now();
  const res = await retry(
    async () => {
      const r = await fetch(URL_RESPONSES, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: env.OPENAI_CONTACT_MODEL,
          tools: [{ type: "web_search" }],
          input: eventsPrompt({ ...o, max }),
          text: { format: { type: "json_schema", name: "conferences", schema: SCHEMA, strict: true } },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (await shouldRetryOpenAi(r)) throw new Error(`openai ${r.status}`);
      return r;
    },
    { maxAttempts: 2 },
  );
  if (!res.ok) await failOpenAi(res, "conference-discovery");
  await recordOpenAiResult("ok", "conference-discovery");
  const body = (await res.json()) as ResponseBody;
  const searches = (body.output ?? []).filter((x) => x.type === "web_search_call").length;
  const events = parseEvents(body);
  const usd = lookupCostUsd(body.usage, searches);
  log.info({ country: o.country, category: o.category, year: o.year, events: events.length, searches, usd, ms: Date.now() - started }, "openai_events.done");
  return { events, usd };
}
