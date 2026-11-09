# Use the in-app assistant ("Ask how")

**Who it's for:** anyone using the dashboard who wants to know how to do something, without reading the manual.

**Where:** the **Ask how** button, bottom-right on every dashboard page.

## How to use it

1. Click **Ask how**. Pick a suggested question, or type your own.
2. To speak: choose the voice language (**EN** or **עב**) and click the mic. The first time, Chrome asks for the
   microphone: choose **Allow on every visit** so it never asks again. Click the mic again (or Send) when done.
3. Press Enter or Send. The answer comes back in English with numbered steps and clickable links to the pages.
4. The chat stays open while you click around the app. The bin icon clears it.

## Rules it follows

- Answers only questions about using this app. Anything else gets a fixed "I can only help with the RateUp app" reply.
- Always answers in English, whatever language the question is in.
- It cannot see or change data. It tells you where to click.
- Its knowledge is `web/lib/assistant/knowledge.ts`. **When a page, button or rule changes, update that file** or
  the assistant will give old directions.

## Setup and cost

- Needs `OPENAI_API_KEY` in **Vercel** (the assistant runs in the web app, not on Cloud Run). Without a key, the
  panel shows "not switched on yet". An expired key or no credit shows a clear message instead of an answer.
- Model: `OPENAI_ASSISTANT_MODEL` (default `gpt-5.4-mini`). About a fraction of a cent per question.
- Voice typing uses Chrome's built-in Google speech recognition: free, no key. Not available in Firefox.
- The site sends `Permissions-Policy: microphone=(self)` so only our own pages can use the mic.

## Code

- `lib/assistant/knowledge.ts` (the guide + suggested questions), `lib/assistant/prompt.ts` (rules, scope guard,
  answer parsing), `lib/assistant/format.ts` (safe answer rendering)
- `lib/services/openai-assistant.ts` (the OpenAI call), `app/api/assistant/route.ts`
- `components/assistant/AssistantWidget.tsx` (panel), `components/assistant/useSpeech.ts` (voice)
