/**
 * api/assistant/route.ts — the in-app assistant.
 *
 * Inputs:  GET — none. POST — { question, history?: [{ role, text }], page? }
 * Outputs: GET → { configured }. POST → { answer, in_scope } (answer is English markdown with app links)
 * Used by: components/assistant/AssistantWidget.tsx
 *
 * One OpenAI call per question (a fraction of a cent). Off-topic questions get a fixed reply.
 */
import { z } from "zod";
import { withApi } from "@/lib/api-wrap";
import { fail, ok } from "@/lib/response";
import { MAX_QUESTION_CHARS, MAX_TURN_CHARS } from "@/lib/assistant/prompt";
import { AssistantError, askAssistant, isAssistantConfigured } from "@/lib/services/openai-assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(MAX_TURN_CHARS * 2) }))
    .max(40)
    .optional(),
  page: z.string().max(300).optional(),
});

const ERROR_TEXT: Record<AssistantError["code"], [string, number]> = {
  not_configured: ["The assistant isn't switched on yet — it needs an OpenAI API key (OPENAI_API_KEY in Vercel).", 503],
  key_invalid: ["The OpenAI API key was refused (expired or wrong). Ask the admin to add a new key in Vercel.", 503],
  no_credit: ["The OpenAI account is out of credit. Ask the admin to top it up.", 503],
  failed: ["The assistant couldn't answer just now. Try again in a moment.", 502],
};

export const GET = withApi(async () => ok({ configured: isAssistantConfigured() }));

export const POST = withApi(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Type a question (up to 2,000 characters).", 422);
  try {
    const { answer, in_scope } = await askAssistant(parsed.data);
    return ok({ answer, in_scope });
  } catch (err) {
    const code = err instanceof AssistantError ? err.code : "failed";
    const [text, status] = ERROR_TEXT[code];
    return fail(text, status);
  }
});
