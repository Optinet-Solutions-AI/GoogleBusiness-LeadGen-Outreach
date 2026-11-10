/**
 * ai-notices.ts — what a batch tells the operator about its AI research (so expectations match the results). Pure.
 *
 * Inputs:  the AI run tally from stage-1 enrichment (lookups, why AI was off or stopped, leads past the cap)
 * Outputs: BatchNotice[] saved to batches.notices (migration 058) and shown on the batch page
 * Used by: lib/pipeline/stage-1-scrape.ts
 */
import { OPENAI_REASON as REASON, type OpenAiState } from "@/lib/ai-status";

export type BatchNotice = { level: "warning" | "info"; text: string };

export type AiRun = {
  /** Lookups still allowed this run (CONTACT_AI_MAX_PER_BATCH at the start). */
  left: number;
  used: number;
  usd: number;
  /** AI was unusable before the first lead (key missing / refused / no credit / unreachable). */
  unavailable: OpenAiState | null;
  /** AI failed mid-run (key refused / out of credit); the rest used the crawl only. */
  stoppedAt: OpenAiState | null;
  /** Leads that wanted AI research but came after the per-batch cap. */
  skippedByCap: number;
};

export function newAiRun(cap: number): AiRun {
  return { left: cap, used: 0, usd: 0, unavailable: null, stoppedAt: null, skippedByCap: 0 };
}

const CRAWL_ONLY = "looked up with the free website crawl only — expect fewer emails and no owner names";

export function aiNotices(ai: AiRun, cap: number): BatchNotice[] {
  const out: BatchNotice[] = [];
  if (ai.unavailable && ai.unavailable !== "ok") {
    out.push({ level: "warning", text: `AI research was off for this batch: ${REASON[ai.unavailable]}. Leads were ${CRAWL_ONLY}.` });
    return out;
  }
  if (cap <= 0 && ai.skippedByCap > 0) {
    out.push({ level: "info", text: `AI research is switched off in the settings (limit 0). Leads were ${CRAWL_ONLY}.` });
    return out;
  }
  if (ai.stoppedAt && ai.stoppedAt !== "ok") {
    out.push({
      level: "warning",
      text: `AI research stopped after ${ai.used} lead${ai.used === 1 ? "" : "s"}: ${REASON[ai.stoppedAt]}. The rest were ${CRAWL_ONLY}.`,
    });
  }
  if (ai.skippedByCap > 0) {
    out.push({
      level: "info",
      text: `AI research covered the first ${cap} leads (the per-batch limit). The other ${ai.skippedByCap} were ${CRAWL_ONLY}.`,
    });
  }
  return out;
}

/** Add new notices to existing ones without repeating a text. Pure. */
export function mergeNotices(existing: unknown, add: BatchNotice[]): BatchNotice[] {
  const prev = Array.isArray(existing)
    ? existing.filter((n): n is BatchNotice => !!n && typeof (n as BatchNotice).text === "string")
    : [];
  const seen = new Set(prev.map((n) => n.text));
  return [...prev, ...add.filter((n) => !seen.has(n.text))];
}
