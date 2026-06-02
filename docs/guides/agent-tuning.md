# Improving the voice agent (the Agent page)

Plain steps for making the AI caller sound better. You do all of this in the browser — **no phone number needed, no real customers called.**

## Where
Left menu → **Agent**.

## What you'll see
- **System prompt** — the agent's instructions (who it is, what to say, how to talk). Edit this freely.
- **Voice** — pick how it sounds. (To see your full list of voices, the 11labs key must be set — see "Voices look limited?" below.)
- **Save** — saves your prompt + voice to the test agent.
- **Reset to recommended** — if an edit made it worse, this puts back our last good version.
- **Start test call** — talk to the agent in your browser and read the live transcript.

## The loop (repeat until it sounds great)
1. Edit the **System prompt** (or pick a different **Voice**).
2. Click **Save**.
3. Click **Start test call**, allow the microphone, and talk to it.
4. Not good? Edit again and Save, or click **Reset to recommended** to go back.

That's it. You're only ever changing the **test** agent — your live/production agents are untouched.

## Tips for a human-sounding agent
- Keep it short: tell it to say **one sentence, then stop and listen** (don't let it monologue).
- Warm + a little upbeat beats flat. A calm voice can sound "lazy" — pick a brighter one or it'll drag.
- Don't make it explain itself ("I'm not trying to sell you…") — real people don't say that.
- One idea per line. If a line sounds rehearsed, cut it.
- (For developers: the recommended prompt lives in `web/lib/voice/agent-prompt.ts`; "Reset to recommended" restores it.)

## Voices look limited?
If the Voice dropdown shows only one or two options, the app is reading voices straight off your assistants. To get your **full named list** (Stephen, Mark, your custom voices…), add your **11labs API key** as `ELEVENLABS_API_KEY` in the environment (`.env` locally, or Vercel for the live site), then restart/redeploy.

## On the live site
The Agent page needs these set in **Vercel → Settings → Environment Variables** (then redeploy):
`VAPI_API_KEY`, `VAPI_AGENT_ID`, and `ELEVENLABS_API_KEY` (for the full voice list). Locally they come from `.env`.
