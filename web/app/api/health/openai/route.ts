/**
 * api/health/openai/route.ts — is AI research available right now?
 *
 * Inputs:  none
 * Outputs: { state: ok | missing | key_invalid | no_credit | unreachable, message } (message = plain-English impact)
 * Used by: components/OpenAiBanner.tsx, components/NewBatchModal.tsx
 *
 * Free: a cached /v1/models key check plus the last recorded real outcome (lib/services/openai-health.ts).
 */
import { withApi } from "@/lib/api-wrap";
import { ok } from "@/lib/response";
import { getOpenAiHealth } from "@/lib/services/openai-health";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => ok(await getOpenAiHealth()));
