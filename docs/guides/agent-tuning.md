# Improving the voice agent (the Agent page)

Plain steps for making the AI caller sound better. You do all of this in the browser — **no phone number needed, no real customers called.**

## Where
Left menu → **Agent**.

## What you'll see
- **System prompt** — the agent's instructions (who it is, what to say, how to talk). Edit this freely.
- **Voice** — set how it sounds: pick a voice from the **Quick pick** list (voices already used by your assistants) or **paste any voice ID** from Vapi, then tune **model / stability / clarity+similarity / speed**.
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

## Picking a voice
The **Quick pick** list shows the voices already used across your Vapi assistants. To use any other voice, copy its **voice ID** from Vapi (Assistant → Voice Configuration → the Voice field / "Add Voice ID Manually") and paste it into **Voice ID**. Then tune the sliders:
- **Stability** — lower = more expressive/varied, higher = steadier (calmer can sound flat/"lazy").
- **Clarity + similarity** — how closely it sticks to the original voice.
- **Speed** — ~0.95 often sounds natural; too slow drags, too fast sounds robotic.
- **Voice model** — `eleven_multilingual_v2` is a safe default.
No extra API key needed — it all goes through your Vapi account.

## On the live site
The Agent page needs `VAPI_API_KEY` + `VAPI_AGENT_ID` set in **Vercel → Settings → Environment Variables** (then redeploy). Locally they come from `.env`.
