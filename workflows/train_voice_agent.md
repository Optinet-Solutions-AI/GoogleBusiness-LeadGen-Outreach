# Train a voice agent (tell it what to change, typed or spoken)

**Owner code:** `web/lib/calls/train-agent-view.ts` (pure: request shape, plain error sentences, before/after lines),
`web/lib/calls/train-agent.ts` (server: calls Voizo), `web/lib/services/voizo.ts` (`trainScript`, `applyTraining`,
`undoTraining`, `listTrainingChanges`), `app/api/voice-training/route.ts`,
`components/voice/TrainAgentModal.tsx`. The script itself lives in **Voizo** — this app never stores it.

**Status:** live since 23 Nov 2026. Checked end to end on the SEO agent (ask → save → in history → undo → back to
the original wording).

## What it is

One box where the operator tells an offer's voice agent what to change, in plain words — typed, or spoken with the
mic (Chrome's free Google speech, English or Hebrew, same as "Ask how"). The agent answers in the same box:

- **"Don't mention price on the first call."** → it shows the lines it would change (now → new) → **Save change**.
- A question it can't act on yet ("which opener?") → it asks back; answer in the same box.
- Something wording can't do ("add a new step that books a meeting") → it says so (that needs Voizo's Script Builder).

Nothing changes until **Save change** is pressed. A saved change is live for the next test call and the next real
call, and every change has **Undo**.

## Where

- Lead page → Contact box → **Test voice agent** → **Train this agent** (trains the offer picked in that window).
- The Voice agents page (`/voice-agents`, hidden from the menu since 20 Nov 2026, open it by its link) → **Train an
  agent** → pick the offer.

## Steps

1. Open the window, pick the offer if asked.
2. Say or type what to change. One thing at a time works best.
3. Read the suggestion (now → new). **Save change** or **Discard**.
4. Press **Test voice agent** on any lead to hear it. Not right? **Undo**, or tell it what to fix.

## Rules (enforced by Voizo, not here)

- Wording only, inside the script's existing lines (opener, statements, answers). No new steps or branches.
- Only facts that are already in the script or that the operator states. Lead details stay as `{{tokens}}`.
- Only the lead-gen test scripts can be changed; a line shared with a Voizo campaign outside them is refused and the
  agent says why. An offer's own closing line (SEO: "…Thanks for taking the call, and best of luck with the
  business!") is NOT shared, so it can be reworded (QA, 23 Nov 2026: the window used to say it couldn't).
- **The standing answers are shared by all eight offers** (who's calling, not interested, do not call, "is this a
  scam?"). Training the SEO agent's "who are you?" answer changes it for the exhibition-stand agent too. Voizo's
  reply ends with "Heads up: that answer is shared by all the offers…" and the window shows that sentence as a
  yellow warning above the change. Read it before saving.
- Locked for the SEO script, as Voizo measured it on 23 Nov 2026 (3 of 21 elements): the End Call line that sits on
  the handler 45 live casino scripts share (the SEO script has a second End Call line of its own, which IS
  editable), and two standing answers ("someone other than the customer answered / wrong number" and "how did you
  get my number"). Seven of the 18 editable elements are the shared standing answers.
- A request about length ("make it shorter") may take longer to answer: Voizo checks how much was really cut and
  tries once more when it was under a fifth.
- It also refuses, with a reason: using a lead detail we don't have for every lead, moving such a detail out of a
  question, emptying a part of the call, and dropping the do-not-call promise.
- 40 questions per offer per day. A suggestion can be saved for 30 minutes; after that, ask again.
- Voizo keeps the history; **Recent changes** in the window shows it with Undo.
- An offer Voizo marks as not trainable (`trainable: false` on `GET /api/v1/scripts`) is left out of the list.

## When it fails

- "Training isn't switched on in Voizo yet" → `VOIZO_API_BASE` points at an old Voizo deployment (training went
  live in Voizo on 23 Nov 2026).
- "That suggestion can't be saved any more" → it was already saved, is over 30 minutes old, or someone else changed
  the script; ask again. Voizo's extra sentence names which part of the script moved.
- "This change can't be undone on its own" → it was already undone, or a newer change touched the same lines; undo
  the newer one first.
- "Voizo couldn't update the live agent, so nothing was changed" → the voice provider refused the new wording and
  Voizo rolled it back; try again in a minute.
- "This agent has used its 40 training requests for today" → try again tomorrow, or train another offer.
- Mic button greyed out → voice typing needs Chrome or Edge; a blocked mic shows how to allow it.

## Cost

Each question is one small OpenAI call **on Voizo's side** (their key). Nothing is dialled. Saving and undoing are free.
