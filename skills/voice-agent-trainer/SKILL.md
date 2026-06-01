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

## Length: lean by default, longer when it earns it
Default to lean — the **generalist stays tight (~150 words)** so it routes fast. But length isn't a
hard cap. What actually hurts speed and naturalness is **knowledge/trivia dump and branchy logic**,
not words that shape *behavior or delivery*. So an **expert can run richer (~250–350)** when the
extra lines buy real value — energy/voice direction, or a few natural objection handles it'll
actually hit. Cut anything the **segment/routing already guarantees** or that's product trivia.
Litmus test: every line either changes how it **behaves** or how it **sounds**. If a line only adds
*facts*, drop it (or route to an expert).

## One static prompt per persona — no per-lead scripting
You write ONE prompt per persona that works for **every** lead in its segment — you can't author a
prompt per call. So **don't inject per-lead content** (e.g. a specific audited website issue). The
*segment* already guarantees the situation (e.g. segment B = the site needs work), so the agent
speaks to it **generically** and lets the caller fill in the specifics — which is more human anyway.
The only variables allowed are universal, auto-filled merge fields: the caller's name and your
company name. If you're tempted to inject computed per-lead detail, that belongs in **segmentation**,
not the prompt.

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
- **Never let the agent explain or justify itself.** A real person doesn't say "I'm not trying to
  sell you anything," "just being honest," or "I'm not being pushy." Announcing your intent is
  itself a salesperson tell — encode the behavior, never have the agent verbalize it.
- **Avoid the "voiceover" cadence.** Smooth, polished, story-narrator delivery (think Facebook
  video voiceovers) reads as fake. Real calls are a little spontaneous and imperfect — a plain
  opener, a half-thought, a quick reaction. Don't write neat parallel sentences or rhetorical
  build-ups; if a line sounds rehearsed, cut it. Write the prompt in second-person *behavior*
  ("you're on a real call, not narrating"), not in marketing copy.

## Make it SOUND human — voice & delivery (half the job)
The script is only half. A great script in a flat, too-fast, talks-over-you voice still sounds like
a bot. **`references/voice-and-delivery.md`** is the full layer — read it whenever you set up or
fix how an agent *sounds*. The high-leverage levers, in order:
1. **Turn-taking** (biggest tell): smart endpointing **on**, `startSpeakingPlan.waitSeconds` ~0.4,
   `stopSpeakingPlan.numWords` 1–2 (so a "yeah" doesn't cut it off), backchanneling on.
2. **Voice quality:** pick a fitting `voiceId`; `speed` ~0.93–0.97; `stability` ~0.4–0.5 (lower =
   less monotone); **fillerInjectionEnabled on** (the antidote to the "voiceover" sound).
3. **Prosody in the prompt:** commas/ellipses for pauses, em-dashes for self-interrupts, contractions,
   no spoken lists, numbers/URLs written how they're said.
Each persona has a starting preset in that file — begin there, then **test-call and tune by ear**.

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
2. Start from the matching prompt in `references/personas.md`; adapt only name/company merge fields —
   **no per-lead content variables**.
3. Apply the 6-block skeleton; **count the words** (<200).
4. Read it back as if spoken — cut anything that sounds *written*, not *said*.
5. Set the **voice & delivery** from `references/voice-and-delivery.md` (persona preset) — the prompt
   is only half.
6. Return all four deliverables (below).
7. If the operator says it "sounds robotic / talks too much," the fix is usually delivery, not words:
   shorten turns (lower max-tokens / a Flow beat), then tune the voice knobs (lower `stability`,
   `speed` ~0.95, filler injection on, smart endpointing) per the voice-and-delivery guide.

## Output format — always return these
- **System prompt** — fenced, copy-paste ready, lean (generalist ~150; expert up to ~350 when it
  buys behavior/delivery), 6-block skeleton, **no per-lead content variables** (name/company only).
- **First Message** — one short spoken opener (the trainer's separate "first message" field).
- **LLM settings** — model (fastest capable) / temperature ~0.7 / max-tokens ~150.
- **Voice & delivery** — suggested voice + turn-taking + TTS knobs from
  `references/voice-and-delivery.md` (start from the persona preset). Half of sounding human — never skip it.

## Don't
- Don't pad with product trivia or knowledge the routing/segment already covers — length should buy
  *behavior or delivery*, not facts (route instead).
- Don't write prices, guarantees, or legal/medical claims into a prompt.
- Don't ignore "stop"/opt-out — it's a hard rule in every agent.
- Don't give the generalist deep product knowledge — its superpower is being fast and routing well.
- Don't make the agent announce it's "not selling / not pushy / just being honest" — show it,
  never say it. And don't write the prompt like polished voiceover narration.
