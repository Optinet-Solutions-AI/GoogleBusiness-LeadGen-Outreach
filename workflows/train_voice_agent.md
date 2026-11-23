# Train a voice agent (tell it what to change, typed or spoken)

**Owner code:** `web/lib/calls/train-agent-view.ts` (pure: request shape, plain error sentences, before/after lines),
`web/lib/calls/train-agent.ts` (server: calls Voizo), `web/lib/services/voizo.ts` (`trainScript`, `applyTraining`,
`undoTraining`, `listTrainingChanges`), `app/api/voice-training/route.ts`,
`components/voice/TrainAgentModal.tsx`. The script itself lives in **Voizo** — this app never stores it.

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
- Outreach → **Voice agents** → **Train an agent** → pick the offer.

## Steps

1. Open the window, pick the offer if asked.
2. Say or type what to change. One thing at a time works best.
3. Read the suggestion (now → new). **Save change** or **Discard**.
4. Press **Test voice agent** on any lead to hear it. Not right? **Undo**, or tell it what to fix.

## Rules (enforced by Voizo, not here)

- Wording only, inside the script's existing lines (opener, statements, answers). No new steps or branches.
- Only facts that are already in the script or that the operator states. Lead details stay as `{{tokens}}`.
- Only the lead-gen test scripts can be changed; a line shared with another Voizo script is refused.
- Voizo keeps the history; **Recent changes** in the window shows it with Undo.

## When it fails

- "Training isn't switched on in Voizo yet" → the Voizo side hasn't shipped `/api/v1/scripts/:id/train` (see the
  request in `docs/status`), or `VOIZO_API_BASE` points at an old deployment.
- "The script changed since this suggestion" → someone else saved a change; ask again.
- "Can't be undone by itself" → a newer change touched the same lines; undo the newer one first.
- Mic button greyed out → voice typing needs Chrome or Edge; a blocked mic shows how to allow it.

## Cost

Each question is one small OpenAI call **on Voizo's side** (their key). Nothing is dialled. Saving and undoing are free.
