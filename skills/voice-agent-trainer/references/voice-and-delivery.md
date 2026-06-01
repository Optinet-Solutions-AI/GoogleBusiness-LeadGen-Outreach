# Voice & delivery — making it SOUND human (not just what it says)

The script is only half of "human." The other half is **how it sounds and how it takes turns**.
A perfect script delivered in a flat, too-fast, never-pausing, talks-over-you voice still screams
"bot." Tune these alongside every prompt. Settings below are for **Vapi** (what Voizo runs on);
voice-quality fields are provider-specific (ElevenLabs / Cartesia / PlayHT), turn-taking fields are
Vapi's. Most can only be set via the API/assistant config.

## The three layers of "sounds human"
1. **Turn-taking & latency** — the single biggest tell. Gaps, talking over the person, or robotic
   instant replies all break the illusion. Tune the speaking plans (below) first.
2. **Voice quality (TTS knobs)** — the actual timbre, pace, expressiveness, and small disfluencies.
3. **Prosody in the prompt** — text-level delivery cues that shape rhythm and naturalness.

---

## 1. Turn-taking & latency (tune this FIRST)

**startSpeakingPlan — when the agent starts after the caller stops:**
- `waitSeconds` (0–5s, default **0.4**) — pause before replying. ~0.4 feels natural; nudge up
  (0.6–0.8) for a calmer, more considered persona; too low → it cuts people off; too high → dead air.
- `smartEndpointingPlan` (Krisp / Deepgram Flux / Assembly / LiveKit / Vapi / off) — detects when the
  caller is *actually done* vs. just pausing mid-thought. **Turn this on.** It's the difference
  between "let me think... *[bot interrupts]*" and a natural beat. Use an audio-based plan
  (Krisp/Deepgram) for the most human feel.

**stopSpeakingPlan — how interruptions (barge-in) are handled:**
- `numWords` (0–10, default **0**) — how many words the caller must say to count as interrupting.
  `0` = barge-in on any sound (snappy, but background noise/"uh-huh" can cut the agent off);
  set **1–2** so a backchannel "yeah/okay" doesn't stop it, but a real interruption does.
- `voiceSeconds` (0–0.5s, default **0.2**) — voice-activity threshold; raise slightly in noisy
  environments to avoid false interrupts.
- `backoffSeconds` (0–10s, default **1.0**) — how long the agent stays quiet after being
  interrupted. Keep ~1.0 so the human can actually finish their thought before it resumes.

**Backchanneling** — short "mm-hm / yeah / right" while the caller talks, to show it's listening
without taking the turn. Enable it; it's a strong humanness cue on longer caller turns.

> Rule of thumb: **fast model + smart endpointing on + waitSeconds ~0.4 + numWords 1–2** gives the
> "talks like a person" feel. If testers say "it cut me off," raise `numWords`/endpointing
> sensitivity; if they say "it's laggy/awkward," lower `waitSeconds`.

---

## 2. Voice quality (TTS knobs — ElevenLabs-style on Vapi)
- `voice.provider` + `voice.voiceId` — **the biggest single lever.** Pick a voice whose age,
  gender, energy, and accent match the persona. Audition several; don't settle for the default.
- `voice.speed` (0.25–2, default **1.0**) — pace. **0.9–0.97** often reads as calmer and more human;
  >1.1 sounds rushed/robotic; <0.85 sounds sluggish. (Provider support varies.)
- `voice.stability` (0–1) — **lower = more emotional range and variation** (less monotone, the
  natural-sounding direction), higher = consistent but flatter. Aim **~0.35–0.5** for natural;
  raise only if it wobbles.
- `voice.style` / `styleGuidance` — expressiveness/emotion. A modest bump adds life; too high =
  theatrical/announcer.
- `voice.similarityBoost` (0–1) — how tightly it sticks to the source voice timbre.
- `voice.useSpeakerBoost` — clarity/presence; on is usually fine.
- `voice.fillerInjectionEnabled` — injects natural "um/uh"-type fillers. **On** for cold outreach —
  small disfluencies read as human (this is the antidote to the "Facebook voiceover" sound).

---

## 3. Prosody in the prompt (text-level delivery)
The TTS reads your text literally, so write for the *ear*:
- Short, broken phrases. Vary sentence length. One thought per line.
- Contractions everywhere ("I'm", "you've", "that's").
- Allow small spoken fillers and softeners: "yeah", "so", "honestly", "I mean".
- Use **commas / ellipses … for micro-pauses** and **em-dashes — for self-interrupts**; punctuation
  is your prosody control.
- Never enumerate ("First… Second… Third…") out loud — that's pure robot.
- Write numbers/URLs the way they're spoken ("eight five five" not "855"; say a link, don't spell it).
- If the TTS supports inline emotion/audio tags (e.g. ElevenLabs v3 `[laughs]`, `[sighs]`), use them
  sparingly for warmth — never in a way the listener would notice as a gimmick.

---

## Per-persona presets (starting points — then tune by ear)
| Persona | Voice vibe | speed | stability | filler | start waitSeconds | notes |
|---------|-----------|-------|-----------|--------|-------------------|-------|
| **John** (generalist) | warm, mid-energy, neutral | 0.97 | 0.45 | on | 0.4 | snappy + friendly; routes fast |
| **Maya** (build) | upbeat, younger, bright | 1.0 | 0.4 | on | 0.4 | enthusiasm without rushing |
| **Sam** (improve) | warm, easy, a little informal — **not sleepy** | 1.0 | 0.4 | on | 0.4 | friendly energy; calm ≠ slow. If it drags, push speed to 1.03 + bump style |
| **Alex** (voice agent) | crisp, clear, confident | 1.0 | 0.45 | on | 0.4 | concrete, not techy |

All four: **smart endpointing on**, `numWords` **1–2**, `backoffSeconds` ~1.0, model = fastest
capable, LLM temperature ~0.7 (variation = less narrated).

---

## Tuning loop — "listen for the robot tells"
After setting the prompt + voice, **make a test call and listen.** Diagnose by symptom:

| What you hear | Fix |
|---------------|-----|
| Monotone / flat | lower `stability`, bump `style`, raise LLM temperature |
| **Sounds lazy / sluggish / low-energy** | **`speed` → 1.0–1.05; lower `stability` (~0.35) + bump `style` for energy; `waitSeconds` → 0.4; pick a brighter voice. "Calm" persona ≠ slow voice — don't over-soften.** |
| Too fast / no breath | `speed` → 0.92–0.95; add commas/ellipses for pauses |
| Sounds rehearsed / "voiceover" | turn filler injection on, shorten lines, cut polished phrasing |
| Cuts me off mid-sentence | raise `numWords` (→2) and enable/strengthen smart endpointing |
| Awkward dead-air gaps | lower `waitSeconds` (→0.3) |
| Talks over my "uh-huh" | raise `numWords`; enable backchanneling |
| Over-enunciates numbers/URLs | rewrite them phonetically in the prompt |

Iterate one knob at a time so you can hear what each change does.

---

## Sources
- [Vapi — Speech configuration](https://docs.vapi.ai/customization/speech-configuration)
- [Vapi — Voice pipeline configuration](https://docs.vapi.ai/customization/voice-pipeline-configuration)
- [Vapi — Voices](https://docs.vapi.ai/providers/voice/vapi-voices)
