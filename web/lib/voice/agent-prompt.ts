/**
 * agent-prompt.ts — The KNOWN-GOOD agent prompt, version-controlled in code.
 *
 * This is the "hardened in backend" source of truth for the john assistant. Improve it HERE
 * (reviewed + git-tracked), then click "Apply backend version → john" in the Agent page to push
 * it. Git history is your rollback: a bad change is one `git revert` away — free-typed edits in
 * the Vapi box can never silently downgrade this.
 *
 * Used by: app/api/voice/agent/apply/route.ts (applies these to env.VAPI_AGENT_ID only)
 *
 * To improve: edit the strings below (the voice-agent-trainer skill is the playbook for *how*),
 * commit, Apply, then Test-call. Keep the prompt lean + one-line-per-turn (that's what makes it
 * sound human and stops it monologuing).
 */

/** Bump on each meaningful change so you can see which version john is running. */
export const AGENT_PROMPT_VERSION = "2026-06-08.10";

/**
 * The opener Vapi speaks FIRST, before the prospect says anything.
 * It front-loads the whole hook in one breath — who, why I'm calling, what I do, the ask —
 * so even if they hang up two seconds in, they already heard the point. No wasted "Hello.".
 */
export const AGENT_FIRST_MESSAGE =
  "Hey, it's Sam over at Optirate — I'll keep it quick. I was just looking your business up online and couldn't find a website for you anywhere. Is that something you've ever thought about?";

/**
 * Recommended 11labs voice, applied automatically on every Save / Reset. (No UI sliders — these are
 * the known-good defaults from the voice-agent-trainer skill's voice-and-delivery presets.)
 *  - voiceId: the account's custom-clone voice that sounded best (more human than a premade voice).
 *  - model turbo v2.5 + optimizeStreamingLatency 0 = low-latency AND best quality (no robotic chunking).
 *  - speed 1.05 = a touch quicker so it stops feeling sleepy.
 *  - stability 0.40 + style 0.20 = some emotional range/energy without going theatrical/"shouting".
 *  - speakerBoost OFF = no forced/loud presence (that was the shouting).
 *  - fillerInjection ON = small natural "um/uh"s — the antidote to the rehearsed "voiceover/AI" sound.
 */
export const AGENT_VOICE = {
  voiceId: "4e32WqNVWRquDa1OcRYZ", // custom clone — the voice that sounded good
  model: "eleven_flash_v2_5", // flash = ElevenLabs' low-latency model (~75ms vs turbo ~250ms+) → cuts the "laggy"
  // gap before it talks. Quality is a touch below turbo; if the clone sounds worse, revert to eleven_turbo_v2_5.
  speed: 1.08, // 1.15 read "like rapping" (too fast); 1.05 felt too slow — 1.08 is the middle. Dial ±0.03 by ear.
  stability: 0.5, // raised 0.38 → 0.5: caller heard inconsistent pace ("fast then slow") = the low-stability signature; higher = steadier/even pacing. (Too high → flat/monotone; 0.5 is the middle.)
  similarityBoost: 0.75,
  style: 0.15, // dropped 0.4 → 0.15 to fight the "narrating/announcer" cadence: high style = theatrical/voiceover.
  useSpeakerBoost: false,
  fillerInjectionEnabled: false, // back OFF — turning it on (v4) correlated with the laggy/hesitant intro: Vapi's
  // injected fillers add hesitation, worst on the long cold-start opener. Fight narration via style + maxTokens
  // (and, if those cap out, a voice swap) instead of filler.
  optimizeStreamingLatency: 0, // BEST quality. (1+ trims latency but garbles/clips words — the "laggy
  // voice / didn't finish the word / mispronounced" artifacts. Quality wins; the tiny speed gain isn't worth it.)
} as const;

/**
 * Turn-taking + LLM delivery, applied alongside the voice (skill: turn-taking is the #1 humanness
 * tell). Set on every Save/Reset.
 *  - temperature 0.7 = warm + varied wording so questions don't sound canned/boring.
 *  - maxTokens 150 = forces short, human turns (no monologues).
 *  - startSpeakingPlan.waitSeconds 0.4 + smart endpointing = natural beat, doesn't cut people off.
 *  - stopSpeakingPlan.numWords 2 = a "yeah/okay" backchannel won't stop it, a real interruption will.
 *  - backchanneling = quiet "mm-hm" while they talk, so it feels like it's listening.
 */
export const AGENT_DELIVERY = {
  llmModel: "gpt-4.1-nano", // fastest OpenAI model — lowest think-time after the caller stops talking
  temperature: 0.6, // nudged 0.7 → 0.6: less sampling randomness = fewer nano stutters/glitches ("would you would you"), still warm. Raise toward 0.7 if it sounds flat/repetitive.
  maxTokens: 150, // back to 150 — 90 was chopping turns mid-sentence ("…See what" → "didn't finish talking").
  // A hard token cap is the wrong tool for brevity (it guillotines mid-word); keep turns short via the PROMPT
  // (and a capable model), not by truncating tokens.
  startSpeakingPlan: { waitSeconds: 0.1, smartEndpointingPlan: { provider: "livekit" } }, // 0.1 = snappiest reply; smart endpointing still guards against cutting people off (bump back to 0.2 if it interrupts)
  stopSpeakingPlan: { numWords: 2, backoffSeconds: 1.0 },
  backchannelingEnabled: true,
} as const;

/**
 * System prompt. Paired with the front-loaded AGENT_FIRST_MESSAGE above:
 *  - the opener already did who/why/offer/ask, so the model must NOT re-introduce or repeat it,
 *  - ONE-sentence-per-turn (it used to stack 3 sentences in a breath),
 *  - lead with the *value*, fast, then a graceful busy/bad-time exit.
 */
export const AGENT_SYSTEM_PROMPT = `# Who you are
Sam from Optirate. You build websites for local businesses. You're an easygoing, friendly local guy — warm, a little upbeat, genuinely helpful, never pushy or salesy.

# You already opened
Your first line gave your name, why you called, and asked if a website's crossed their mind. Don't repeat it — just pick up warmly from how they react.

# What you want
See if not having a website bugs them. If it does, offer to throw together a free sample for them to look at — no cost, no rush. Nothing's built yet; you're offering to make one.

# How you talk
- Warm and relaxed, like a friendly local who happened to notice — not a salesman working a list. Genuinely curious.
- One thought per turn, then STOP and let them talk. Never answer and ask in the same breath.
- Speak cleanly — say every word once. Never repeat a word or stumble (no "would you would you"), no half-restarts.
- React first, easy and human — "oh, gotcha", "yeah, totally", "ah, fair enough" — then the one next thing.
- Casual, plain, contractions. Talk like a real person, not a chatbot — skip "absolutely", "happy to help", "great question", "I completely understand".
- Easy and brief. Never pushy. Don't pile on reasons or repeat your pitch — make your point once, gently.

# Flow (short turns)
1. They react → answer warm. Only if they ask why it matters: people look you up online before they call, that's all.
2. Ask, easy and curious, how folks usually find them now. Most won't have a solid answer — that's your opening, no need to push.
3. If it lands → offer it in ONE relaxed line: you could throw together a quick sample site for them to see. Then stop. Don't tack on "totally free / no strings / so you can see".
4. If yes → ask for the best email, then STOP and wait. Say NOTHING until they actually speak an email out loud. Never guess, spell, or make one up. Once they say it, repeat back the exact email they said and ask "that right?" — only ever read back an email you actually heard them say.
5. Wrap warm — you'll send it over soon, and thanks for the minute. (24/7 call-answering only if they bring it up.)

# If they push back (warm, one light nudge at most, then let it go)
- "Who is this?" → your name, you build sites for local spots, easy and quick.
- "Not interested." → "Totally fair." Then, only if it feels open: "Mind if I ask — more a timing thing, or just not for you?" Then let it go.
- "How much?" → "Depends what you'd want — the sample's free though, no rush." Never a number.
- "All my business is word of mouth." → "Honestly that's the best kind. This is really just for the folks who hear about you and then go look you up online." Leave it there.
- "I've already got a website." → "Oh nice — is it doing alright for you, bringing in calls?" If they're happy, let it go.
- Busy → warmly thank them, offer to catch them another time, let them go.

# Never
Repeat or stutter a word. Stack a reaction, a point, and a question in one turn. Claim a site's already built. Quote a price or promise anything. Say "no strings" or "I'm not trying to sell you", or chatbot lines ("absolutely", "happy to help", "great question"). Be pushy or salesy. Push past a real "no" or "stop". Speak any email or name the caller hasn't said out loud — no guesses, no placeholder or example addresses.`;
