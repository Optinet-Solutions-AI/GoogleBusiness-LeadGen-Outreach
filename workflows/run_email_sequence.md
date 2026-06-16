# Workflow — Screenshot-First Email Sequence (follow-up rules + safeguards)

**Objective:** send the approved 4-step progressive-trust cold-email sequence to a lead and follow up on the right cadence — while **never following up on an address that was blocked or where a send didn't actually go out**, because that is what damages sender reputation.

**Owner code:** `web/lib/pipeline/sequence-scheduler.ts` (engine), `web/lib/email/sequence-templates.ts` (copy), `web/app/api/email/sync/route.ts` + `web/app/api/webhooks/instantly/route.ts` (reply/bounce stops). Runs on Cloud Run via `MODE=sequence`, fired every 15 min by the Cloud Scheduler job `email-sequence-tick`.

---

## The sequence

| Step | Day | Contains | Notes |
|------|-----|----------|-------|
| 1 | 0  | plain text — no image, no link | permission-ask |
| 2 | 4  | + inline screenshot | no link |
| 3 | 8  | + live demo link | no screenshot |
| 4 | 12 | break-up close | no image/link |

Every step is **4 days apart**. Two copy variants: **build** (`no_website`) and **improve** (`old_website`).

Enrollment is operator-initiated (dashboard **SequenceCard → Enroll**, or `POST /api/leads/:id/sequence {action:"enroll"}`). Enrollment is refused unless the lead has an email, a `demo_url`, isn't suppressed, and isn't verification-`skip`.

---

## Who gets a follow-up — and who does NOT

On each tick, before sending the next step, the engine re-checks the lead. A step is sent **only** when every gate passes. If any of these is true, the sequence **STOPS** (status `stopped`, `seq_next_step_at = null`) and no further email is sent:

| Condition | How it's detected | Why we stop |
|-----------|-------------------|-------------|
| **Replied** | `inbox_status='needs_reply'` or `stage='replied'` (set by inbox sync / webhook) | a human answered — a bot follow-up would be rude + risky |
| **Unsubscribed / DNC** | `lifecycle_stage in ('unsubscribed','dnc')` or a `suppressions` row | legal + reputation |
| **Bounced** | an `email_bounced` event exists for the lead (see below) | following up a dead mailbox is the #1 reputation killer |
| **Send failed** | the SMTP send returned a failure (recipient refused / 5xx at send time) | the message never landed — do not pile on another |
| **Unverified (invalid)** | `verification_status='invalid'` via the send-gate | don't send to known-bad addresses |

Two conditions **pause without stopping** (they retry later, never advance the step):

| Condition | Behaviour |
|-----------|-----------|
| **Kill switch** (`EMAIL_SENDING_PAUSED_UNTIL` in the future) | tick exits immediately; no state change |
| **Daily cap / warmup** (`capped`) or paused mailbox | this lead's due time is restored; retried on a later tick |
| **Verification `hold`** (status `unknown`/never verified) | re-checked in 24h; never sent until it clears |

**Core rule (in code):** `classifySendOutcome()` returns `advance` only when the email actually went out (`sent === true`, or a `$0` no-op in dev). `paused`/`capped` → `defer` (retry). Anything else → `fail` → **stop**. The ladder advances *only* on `advance`. This is unit-tested in `sequence-scheduler.test.ts`.

---

## Bounce handling (the reputation safeguard)

Bounces stop the sequence through three independent paths, so a bad address can't keep getting follow-ups:

1. **At send time (synchronous):** if the SMTP server rejects the recipient (5xx at `RCPT TO`), `sendOutreachEmail` returns `sent:false` → `classifySendOutcome` → `fail` → sequence stops, an `email_send_failed` event is logged. *This catches most dead addresses on step 1.*
2. **Async NDR via the inbox** (`POST /api/email/sync`): `classifyReply()` detects non-delivery reports (from `MAILER-DAEMON`/`postmaster`, "Undeliverable"/"Delivery Status Notification" subjects, `multipart/report`, `X-Failed-Recipients`). On a match it records an `email_bounced` event and stops the sequence. A **hard** bounce also sets `verification_status='invalid'` so a future re-enroll won't resume to a dead mailbox; a **soft** bounce stops the current ladder only.
3. **Pre-send gate:** before sending any step, the engine checks for an existing `email_bounced` event and stops if one is found — covering a bounce recorded by any path (sync, webhook, or manually).

**Known limitation:** async NDRs are matched to a lead by the original `Message-ID` in the bounce's `In-Reply-To`/`References`. Some providers omit those, so a minority of async bounces won't auto-match. The synchronous send-time check (path 1) is the primary protection; the bounce gate + the verification gate backstop it. If reputation metrics dip, tighten by lowering the warmup cap and verifying the whole list before enrolling.

---

## Operator controls

- **Enroll / Stop / Re-capture:** dashboard SequenceCard, or `POST /api/leads/:id/sequence {action}`.
- **Pause ALL sequence sends:** `gcloud scheduler jobs pause email-sequence-tick --location=us-central1` (resume with `resume`).
- **Global email kill switch:** set `EMAIL_SENDING_PAUSED_UNTIL` to a future ISO timestamp — halts every send (sequence + one-off) instantly.
- **Re-enrolling a stopped lead:** allowed, but a hard-bounced lead is now `verification_status='invalid'`, so enrollment will refuse it until the email is fixed + re-verified. That's intentional.

---

## Verifying it works

- Logic is locked by unit tests: `web/lib/email/sequence-templates.test.ts` (per-step content), `web/lib/pipeline/sequence-scheduler.test.ts` (advance/defer/fail + step scheduling), `web/lib/services/auto-reply-detector.test.ts` (bounce detection).
- End-to-end smoke: `MODE=sequence` with nothing enrolled → `sequence.tick_done due=0 sent=0`.
- Live follow-up check: enroll a TEST lead whose email is one you own (see `web/scripts/seed-test-reply.ts`, which uses the operator's own inbox), then force `seq_next_step_at` into the past and run the tick repeatedly — confirm each step lands, the screenshot embeds on step 2, the link appears on step 3, and a seeded reply/bounce stops the ladder.
