# Test mode (safeguard while QA tests)

Since 26 Nov 2026 (operator: "make sure there are safeguards so QA won't make a mistake"). Migration **075**.

## What it does

While **Test mode** is on, the app sends nothing to a real business. Every send point checks the address against the
**test list** (emails, phone numbers, website hosts) on the server, at the moment of sending:

| What | Where it's checked | A real business gets… |
|---|---|---|
| Every email (Send email, Reply, Compose, sequences, batch emails, Brain, test sends) | `lib/services/email-sender.ts` `sendFromAccount` (the bottom of every email) + `sendOutreachEmail` | refused with a plain message (hand sends) / **waits** in its sequence (held like the kill switch, never stopped) |
| Send email window | `lib/email/send-simple.ts` (before any check or paid verification) | refused: "Test mode is on…" |
| Batch email / Brain emails | `skipReason` → "Not a test contact" | left out of the campaign |
| Contact forms (Contact page, Send to: Contact page / Both, automatic, Brain) | `lib/contact-form/runs.ts` `startSend` / `startLookThenSend` and again by the worker before filling | refused / the run is "blocked" with the reason |
| AI calls (Call with AI, campaigns, Brain) | `lib/calls/quick-call.ts` (not queued), `lib/pipeline/call-scheduler.ts` (a queued call **waits**), `lib/services/voizo.ts` `placeCall` (last line: nothing dialled) | refused / waits in the queue |
| SMS (dormant) | `lib/services/mobivate.ts` `sendSms` | not sent |
| Brain Approve | `lib/brain/approve.ts`: every ticked channel of every ticked lead | the whole approval is refused, naming the leads |

Looking at a contact form (a screenshot) and the browser "Test voice agent" are allowed: nothing is sent to anyone.

**Fail-closed:** if the setting can't be read (migration 075 not run, database error), Test mode counts as ON with an
empty list, so nothing at all is sent. A blue banner on every page says Test mode is on.

## The switch (operator only, by asking Claude)

The app has no button for it. From `web/`:

```
npx tsx --tsconfig tsconfig.json scripts/test-mode.ts --get
npx tsx --tsconfig tsconfig.json scripts/test-mode.ts --add-email=qa@example.com --add-phone=+15125550123
npx tsx --tsconfig tsconfig.json scripts/test-mode.ts --add-host=example-test-site.com
npx tsx --tsconfig tsconfig.json scripts/test-mode.ts --off      # go live (operator's word only)
npx tsx --tsconfig tsconfig.json scripts/test-mode.ts --on
```

The test addresses are private: they live in the database (`app_settings`), never in git. The printout masks them.
The app's own host (for `/test-form`) is on the list from the migration. Changes take effect within 30 seconds.

## Going live

1. QA passed. 2. The operator says "switch to live". 3. `--off`. Emails and calls that waited during Test mode then go
out at their usual pace (daily caps and calling hours still apply): check the Campaigns page first and pause anything
that shouldn't go.

## When it fails

- "Test mode is on: …" when QA sends to their own address → the address isn't on the list (or has a typo): add it.
- Nothing is sent at all, even to the test list → migration 075 not run (fail-closed).
