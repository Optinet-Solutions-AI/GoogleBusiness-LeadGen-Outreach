/**
 * exhibitor-notice.ts — the batch message that says what a conference search found, show by show (19 Nov 2026). Pure.
 *
 * Inputs:  the exhibitors run log (shows read and what each gave), country, category, companies kept, duplicates
 * Outputs: one BatchNotice for batches.notices — a warning when nothing was kept (so "done, 0 leads" is never silent)
 * Used by: lib/pipeline/stage-1-scrape.ts (scraper 'exhibitors')
 */
import { countryLabel } from "../data/cities";
import { EUROPE_ALL, EXHIBITOR_CATEGORIES } from "../data/exhibitor-categories";
import type { ExhibitorRunLog } from "../services/exhibitors";
import type { BatchNotice } from "./ai-notices";

const MAX_LISTED = 8;
const PASTE = "paste a conference's exhibitor page or ExpoFP floor-plan link in the batch form";

function place(country: string): string {
  const c = country.trim().toLowerCase();
  if (c === EUROPE_ALL) return "Europe";
  const name = countryLabel(c);
  return name ? `${name} (${c.toUpperCase()})` : c.toUpperCase();
}

function showLine(e: ExhibitorRunLog["events"][number]): string {
  switch (e.source) {
    case "expofp":
      return `${e.name} — ${e.exhibitors} exhibitors (floor plan)`;
    case "page":
      return `${e.name} — ${e.exhibitors} exhibitors (exhibitor page)`;
    case "blocked":
      return `${e.name} — the site blocks robots, paste its ExpoFP floor-plan link`;
    case "empty":
      return `${e.name} — no exhibitor list on its pages yet`;
    default:
      return `${e.name} — ${e.detail ?? "couldn't open its pages"}`;
  }
}

export function exhibitorNotice(o: {
  run: ExhibitorRunLog;
  country: string;
  category: string;
  kept: number;
  duplicates: number;
}): BatchNotice {
  const events = o.run.events;
  if (!events.length) {
    const cat = EXHIBITOR_CATEGORIES.find((c) => c.value === o.category)?.label ?? o.category;
    return {
      level: "warning",
      text: `No conferences with an exhibitor list were found for ${cat} in ${place(o.country)}. Try All of Europe or another country, or ${PASTE}.`,
    };
  }
  const listed = events.slice(0, MAX_LISTED).map(showLine).join("; ");
  const more = events.length > MAX_LISTED ? `; and ${events.length - MAX_LISTED} more` : "";
  const head = `Conferences checked (${events.length}): ${listed}${more}.`;
  if (!o.kept) {
    return { level: "warning", text: `${head} No companies kept. ${PASTE[0].toUpperCase()}${PASTE.slice(1)} to try a specific show.` };
  }
  const dup = o.duplicates ? `, ${o.duplicates} duplicates left out` : "";
  return { level: "info", text: `${head} ${o.kept} companies kept${dup}.` };
}
