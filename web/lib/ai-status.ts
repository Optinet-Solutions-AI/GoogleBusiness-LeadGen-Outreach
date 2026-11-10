/**
 * ai-status.ts — the words for "is OpenAI usable?" shared by the banner, the batch form and batch notices. Pure.
 *
 * Inputs:  an OpenAiState
 * Outputs: a short reason ("the OpenAI key was refused …") and a full message with what that means for the user
 * Used by: lib/services/openai-health.ts, lib/pipeline/ai-notices.ts
 */

export type OpenAiState = "ok" | "missing" | "key_invalid" | "no_credit" | "unreachable";

export const OPENAI_REASON: Record<OpenAiState, string> = {
  ok: "OpenAI is working",
  missing: "no OpenAI key is set",
  key_invalid: "the OpenAI key was refused (expired or wrong)",
  no_credit: "the OpenAI account is out of credit",
  unreachable: "OpenAI wasn't answering",
};

/** Plain-English impact of each state, written to lower expectations rather than alarm. */
export function openAiStateMessage(state: OpenAiState): string {
  if (state === "ok") return "OpenAI is working.";
  const lead = state === "unreachable" ? "AI research may be unavailable" : "AI research is off";
  return (
    `${lead}: ${OPENAI_REASON[state]}. Until it's fixed, lead research uses the free website crawl only ` +
    "(fewer emails, no owner names), conference discovery needs pasted links, and the Ask how assistant is off."
  );
}
