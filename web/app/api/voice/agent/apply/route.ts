/**
 * api/voice/agent/apply/route.ts — Apply the version-controlled backend prompt to john.
 *
 * POST: pushes AGENT_SYSTEM_PROMPT + AGENT_FIRST_MESSAGE (from lib/voice/agent-prompt.ts)
 * onto the managed assistant (env.VAPI_AGENT_ID ONLY — never another). The "restore the
 * known-good version" action; git history of agent-prompt.ts is the rollback.
 */
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { isVapiConfigured, updateAgent } from "@/lib/services/voice/vapi-admin";
import { AGENT_SYSTEM_PROMPT, AGENT_FIRST_MESSAGE, AGENT_PROMPT_VERSION } from "@/lib/voice/agent-prompt";

export const dynamic = "force-dynamic";

export const POST = withApi(async () => {
  if (!isVapiConfigured()) return fail("Vapi not configured", 503);
  await updateAgent({ systemPrompt: AGENT_SYSTEM_PROMPT, firstMessage: AGENT_FIRST_MESSAGE });
  return ok({ applied: true, version: AGENT_PROMPT_VERSION });
});
