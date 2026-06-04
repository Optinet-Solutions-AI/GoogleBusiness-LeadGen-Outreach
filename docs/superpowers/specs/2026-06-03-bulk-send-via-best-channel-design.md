# Spec — Bulk "Send via best channel" (2026-06-03)

## Goal
On the Leads page, select leads → one **"Send via best channel"** action that auto-routes each lead
to the right outreach channel. Removes per-lead manual buttons. Runs at $0 (soft no-op) until a
mailbox / SMS key is connected.

## Routing rule (per lead, in order)
1. Already outreached (stage in `outreached`/`replied`/`meeting_booked`/`meeting_done`) and no
   `resend` flag → **skip (already)**.
2. Has an `email` → send **email** (`stage-5-email.run`).
3. Else has a `phone` → send **SMS** (`stage-6-sms.run`).
4. Else → **skip (no contact)**.

Suppression (DNC/STOP/unsubscribed) is enforced inside the stages, which return
`skipped:'suppressed'` — the bulk runner just tallies it. (Rule = "use whatever contact exists.")

## Components
- **`web/lib/outreach/route-send.ts`** — pure-ish helpers:
  - `chooseChannel(lead) → { channel: 'email'|'sms'|'skip', reason }` (contact-availability + dedup).
  - `sendViaBestChannel(lead) → { channel, sent, skipped?, noop? }` — calls the matching stage.
- **`POST /api/leads/send`** — body `{ leadIds: string[], dryRun?: boolean, resend?: boolean }`.
  - `dryRun:true` → routing breakdown only, no sends.
  - real → loop (cap 100/request, small concurrency), return
    `summary: { emailed, texted, skipped_no_contact, skipped_already, skipped_suppressed, failed }`.
- **Leads page UI** — row checkboxes + a sticky action bar ("N selected · Send via best channel") →
  confirm dialog shows the dry-run preview (X email · Y SMS · Z skipped) → confirm → real send →
  result toast. Reuses the existing email + SMS stages.

## Safety / $0
- Sends are **soft no-op** until a mailbox/SMS key is connected → fully testable today, zero real sends.
- **Dedup** (skip already-outreached) + **preview-before-send** prevent accidents.
- Per-request cap (~100) to stay within the serverless time budget.

## Out of scope (today)
- DM channel (no-website + no phone → "no contact" for now).
- Real sending (needs the operator's mailbox / Mobivate key).
- Auto-fire-on-enrich and "send all matching filter" (later add).
