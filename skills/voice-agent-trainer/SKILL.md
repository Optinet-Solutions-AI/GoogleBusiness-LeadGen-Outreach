---
name: voice-agent-trainer
description: >
  Write or refine voice-agent system prompts that sound human and respond fast, for the
  Voizo/Vapi call trainer. Use this WHENEVER the operator is training a call agent, writing or
  tweaking a voice "system prompt" / "first message", picking or pairing a voice, or says things
  like "make the AI sound more human", "the agent sounds robotic/scripted", "keep it under 200
  words", "the bot talks too much", "write the generalist/triage agent", "write the expert agent
  for build/improve/voice", or "mix and match the voice and the prompt". Covers the three offers
  (build_website / improve_website / voice_agent) and the generalist → expert → upsell topology.
  Reach for it even when the operator doesn't say the word "skill".
---

# voice-agent-trainer

## Why this exists
A cold AI call only works if it sounds like a real person **and** answers fast. Two levers control
that: the **prompt** (what the agent knows + how it talks) and the **voice + settings** (how it
sounds + how quickly it takes turns). A fat prompt is the #1 cause of robotic, laggy calls — the
model spends longer "thinking" and starts lecturing. This skill keeps prompts lean and pairs them
with the right voice so every agent feels human and quick.

Offer context lives in `workflows/run_voice_outreach.md` and `web/lib/offers.ts` (the three offers
+ how a lead is routed). This skill is the "how to write/voice the agent" layer on top.

## The hard rule: under ~200 words
Keep every agent prompt under ~200 words, and **count before shipping**. Less knowledge = faster,
warmer replies. If an agent seems to "need" more facts, that's the signal it should **route to an
expert**, not memorize more. The generalist especially stays shallow on purpose — its only job is
to find the fit and hand off.

## The 6-block skeleton (use for every agent)
Write prompts as these six short blocks. The headers help the model parse and keep you disciplined.

1. **Identity** — who they are, one warm line (name + company + what you help with).
2. **What you offer / are selling** — generalist: name the 3 services, "high level only, don't pitch
   details." Expert: the ONE service, known well but stated plainly.
3. **Your job** — the single outcome (generalist: qualify → confirm → hand off; expert: confirm fit
   → line up next step → one upsell).
4. **How you talk** — the human-sounding rules (below).
5. **Flow** — 4–6 numbered beats: opener → discovery → reflect-back → ask → hand-off / next step.
6. **Rules** — hard limits: no prices/technical promises, honor "stop", let them go gracefully.

## How to make it sound human (put these in "How you talk")
These matter because real phone conversation is *short and reactive*, not a monologue:
- Short sentences, contractions, **one question at a time**.
- Cap each reply at a sentence or two — no speeches.
- Acknowledge / mirror what they said before moving on (people need to feel heard).
- Let them interrupt; never talk over them.
- Plain words, zero jargon; curious, not salesy.
- Vary phrasing so it never sounds looped or canned.

## Mix & match (voice × persona × offer)
Don't guess the pairing — build each agent as a deliberate triple. Ready-to-paste prompts for all
four live in `references/personas.md` — start there and tweak, rather than writing from scratch.

| Persona | Offer focus | Voice vibe | Job |
|---------|-------------|------------|-----|
| Generalist (triage) | all 3, shallow | warm, neutral, fast | qualify + route |
| Build expert | build_website | upbeat, confident | show the free demo site |
| Improve expert | improve_website | calm, consultative | name the gaps, offer the rebuild |
| Voice-agent expert | voice_agent | crisp, friendly | sell the 24/7 receptionist |

**Settings that ride with the voice** (the knobs next to the prompt in the trainer):
- **Model:** fastest capable one — latency beats depth here.
- **Temperature:** ~0.6 (warm but consistent).
- **Max tokens:** low (~150) — this is what forces short, human turns.
- **Turn-taking:** interruptions/barge-in on, short silence timeout → fast replies, no steamrolling.
- A slower/warmer voice → trim the prompt further so total response time stays low.

## Expert-only extras
Every expert prompt ends with **one** upsell beat that maps to the lead's `secondary_offer`
(usually the 24/7 voice agent). Keep it a single, low-pressure line — "want me to include that?" —
then note interest for a specialist. Don't stack multiple upsells; it kills the human feel.

## Workflow when asked to write or refine an agent
1. Confirm the **persona + offer + voice** triple (ask if it's unclear which one).
2. Start from the matching prompt in `references/personas.md`; adapt names/{{variables}}.
3. Apply the 6-block skeleton; **count the words** (<200).
4. Read it back as if spoken — cut anything that sounds *written*, not *said*.
5. Return all three deliverables (below).
6. If the operator says it "sounds robotic / talks too much," the fix is almost always: shorten
   turns (lower max-tokens), cut a Flow beat, or move detail out to an expert — not add words.

## Output format — always return these three
- **System prompt** — fenced, copy-paste ready, under ~200 words, 6-block skeleton.
- **First Message** — one short spoken opener (the trainer's separate "first message" field).
- **Settings** — model / temperature / max-tokens / turn-taking / suggested voice.

## Don't
- Don't exceed ~200 words or stuff in product detail "just in case" — route instead.
- Don't write prices, guarantees, or legal/medical claims into a prompt.
- Don't ignore "stop"/opt-out — it's a hard rule in every agent.
- Don't give the generalist deep product knowledge — its superpower is being fast and routing well.
