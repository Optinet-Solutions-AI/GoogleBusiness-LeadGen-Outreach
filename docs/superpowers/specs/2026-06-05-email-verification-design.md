# Email Verification System — Design (full ladder port)

**Date:** 2026-06-05
**Status:** Approved (brainstorming) → ready for implementation plan

## Goal

Verify a lead's email before it's allowed into a send, so we stop mailing dead/scraped
addresses and protect sender reputation (bounce rate → deliverability). Port the proven
**layered-ladder** design from `email-verification-system.md` (the Trustpilot project's
system) into THIS app's stack — Next.js `web/` + the Cloud Run job runner + Supabase.

## Context

Our leads carry a single `email` (crawled by Apify / the contact-page crawl) that is **never
validated** today — we send as-is and only learn of bad addresses via bounces. The reference
doc describes a 7-stage validator (free local checks → paid cloud verifiers) but it lives in
a different codebase (`server/src/...`, `trustpilot-crm`). Nothing exists in our app yet.

## Key constraint (drives the whole adaptation)

**Vercel and Cloud Run both block outbound port 25.** So the free SMTP stages (catch-all
probe, RCPT probe) return `unknown` in production — exactly the caveat the reference doc
flags for its own Cloud Run service. Therefore:

- **ZeroBounce is the production workhorse** (HTTP API, no port 25 needed).
- The **SMTP stages only do real work in a local backfill script** (a dev box / VM with port
  25 open), kept as an operator helper — not the live path.
- **Batch verification runs as a Cloud Run job** (`MODE=verify`) — it makes HTTP verifier
  calls and can run long; no Vercel 60s limit, no port 25 dependency.

## Requirements (locked)

1. **Full ladder**, env-gated paid tiers: syntax → MX/DNS → catch-all probe → SMTP RCPT
   probe → **ZeroBounce** (primary) → **MillionVerifier** (tier 2) → **Hunter** (tier 3).
2. **4-value verdict:** `valid · invalid · catch-all · unknown`. **No-guessing rule** — a
   `valid` needs positive proof (SMTP `250` on a non-catch-all domain, or a cloud verifier
   explicitly returning valid); catch-all domains are `catch-all`, never `valid`;
   inconclusive stays `unknown`.
3. **Per-domain caching** (catch-all + MX/provider intel cached 7 days).
4. **Gate before send** (stage-5-email + campaign launch): **block `invalid`, hold
   `unknown`, allow `valid` + `catch-all`.**
5. **Backfill** existing leads + an on-demand **Verify** action; **"verified email"** filter
   on the Leads page; verdict shown in the lead UI.

## Architecture

### Core ladder — `web/lib/services/email-validator/`
- `index.ts` — `verifyEmail(email, opts?) → VerifyResult` (`{ status, stages, provider }`).
  Runs stages in order, short-circuits on a definitive verdict, returns the audit trail.
- `syntax-check.ts` — stage 1, free, regex.
- `dns-check.ts` — stage 2, free, `node:dns/promises` `resolveMx` (works on Vercel/Cloud
  Run); classifies `provider_type` (google_workspace / outlook365 / cpanel_or_other) from
  the top MX. No MX → `invalid`.
- `catch-all-probe.ts` — stage 3, SMTP (port 25). Per-domain, cached 7d in
  `domain_email_intel`. **No-ops to `unknown` where port 25 is blocked (prod).**
- `smtp-probe.ts` — stage 4, SMTP `HELO → MAIL FROM → RCPT TO → QUIT` (never `DATA`).
  **No-ops to `unknown` in prod.** Uses `SMTP_PROBE_HELO`/`SMTP_PROBE_FROM`.
- `email-verifier.zerobounce.ts` — stage 5 (primary). Maps ZB taxonomy → 4-value per the
  doc (`spamtrap`/`abuse` → invalid; `toxic` → unknown; `do_not_mail` → catch-all except
  `global_suppression`/`possible_trap` → invalid). Batch endpoint (100/request).
- `email-verifier.millionverifier.ts` — stage 6 (`ok`→valid, `catch_all`→catch-all,
  `disposable`→unknown). Fires only on `unknown` and when key set.
- `email-verifier.hunter.ts` — stage 7. Skips free-webmail domains; per-hour cap. Fires only
  when ZB+MV still `unknown` and key set.
- All external calls go through `lib/retry.ts` + logged via `lib/logger.ts` (house rule).

### Verdict resolution
One `email` per lead → one `verification_status`. (No multi-source `resolvePrimaryEmail` —
that part of the reference doc doesn't apply to our single-email leads.)

### Execution surfaces
- **Batch verify (Cloud Run job):** extend `scripts/cloud-run-job.ts` with `MODE=verify`
  (env `VERIFY_LIMIT`, optional `VERIFY_LEAD_IDS`). Pulls leads where `email is not null`
  and (`verification_status is null` or `email_verified=false`), runs each through
  `verifyEmail`, writes the verdict + audit columns + domain cache. Skips already-`valid`.
  A `web/scripts/verify-leads.ts` CLI mirrors it (`npm run verify:leads`).
- **Inline sync:** `POST /api/verify/sync` (Vercel) — re-verify ≤5 lead ids on demand
  (the "click an invalid lead" path); recomputes status, writes a verification note.
- **Local SMTP backfill:** the same CLI run from a port-25-open box does the free
  RCPT/catch-all probes for real (documented as an operator helper).
- **Trigger + status:** `POST /api/verify` enqueues/triggers the Cloud Run job (mirrors how
  scraping is triggered) and returns immediately; the Leads page shows live
  `verification_status` counts (polling/refresh) — **no SSE** (awkward across Cloud Run; the
  reference's SSE is out of scope).

## DB — migration 029 (then port to `db/schema.sql`)

`domain_email_intel` (new, **RLS disabled**):
`domain text pk, mx_top text, provider_type text, is_catch_all bool, checked_at timestamptz`.
Catch-all/provider reused for 7 days → a whole domain costs one probe.

`leads` (alter, `add ... if not exists`):
`verification_status text` (`valid|invalid|catch-all|unknown`, null = unchecked),
`email_verified bool default false`, `verified_at timestamptz`,
`verify_syntax_ok bool`, `verify_mx_ok bool`, `verify_smtp_result text`,
`verify_zerobounce_result text`.
(No RLS change needed on `leads` — already off. The new table MUST disable RLS — prod reads
with a key subject to RLS, same lesson as `email_messages`.)

## Gate (where verification is enforced)
The gate is **opt-in**: it only activates when a `ZEROBOUNCE_API_KEY` is set. With no key,
it's a full no-op and the app sends exactly as today (so nothing breaks before keys exist).

When **active**, before `sendOutreachEmail` in `web/lib/pipeline/stage-5-email.ts run()`,
read the lead's `verification_status`:
- `valid`, `catch-all` → **send**
- `invalid` → **skip** (`skipped:'unverified'`)
- `unknown` → **hold** (`skipped:'unverified'`)
- `null` (never verified) → **treat as `unknown` → hold**, so unverified leads are never
  blind-sent once verification is turned on (operator runs the batch verify first / at launch).

`web/app/api/campaigns/[id]/launch/route.ts` applies the same policy per member; skipped +
held leads are reported in the launch summary so the operator sees how many need verifying.

## UI
- **Leads page** — add a **verification filter** (`All · Verified · Unverified · Invalid`)
  alongside the email filter; show a small verdict chip per row; a **Verify** action
  (header) that triggers the batch job; the existing coverage line gains a "verified" count.
- **Lead detail** — show the verdict + the per-stage audit trail (tooltip), and a
  re-verify (`/api/verify/sync`) button.

## Config (env) — `lib/config.ts` + `.env.example`
`ZEROBOUNCE_API_KEY` (required for any paid stage), `MILLIONVERIFIER_API_KEY` (optional),
`HUNTER_API_KEY` (optional), `HUNTER_MAX_CALLS_PER_HOUR` (default 20), `SMTP_PROBE_HELO`
(default `optiratesolutions.com`), `SMTP_PROBE_FROM` (default `verify@optiratesolutions.com`).
All paid keys env-gated → unset stage no-ops; ships safely, add keys without a redeploy.

## Error handling & safety
- All DB reads via `safeDb`; all verifier calls wrapped in `retry` + try/catch → a provider
  error degrades to `unknown`, never throws into the pipeline.
- **Never burn paid APIs without confirmation** (house rule): batch verify is operator-
  triggered; the ladder spends only on leftover `unknown` cases; ZeroBounce free tier is
  100/mo, so we log the count + cost before a large run.
- Migration 029 disables RLS on the new table.

## Testing (vitest)
- `syntax-check`, `dns-check` classification, each verifier's taxonomy → 4-value mapping
  (table-driven from the doc), the orchestrator's short-circuit + no-guessing rule, and the
  gate policy (invalid skip / unknown hold / valid+catch-all send).

## Build order
1. **Core ladder + config + tests** (`email-validator/*`, env) — no DB, no wiring.
2. **DB** — migration 029 + `schema.sql` port (operator applies).
3. **Execution** — Cloud Run `MODE=verify` + `verify-leads.ts` CLI + `/api/verify` trigger +
   `/api/verify/sync`.
4. **Gate** — stage-5-email + campaign launch.
5. **UI** — Leads verification filter + verdict chips + Verify action + lead-detail audit.

## Out of scope (future)
- SSE live-progress stream (replaced by polling/lead-row status on our infra).
- Multi-source email resolution (`resolvePrimaryEmail`) — we have a single `email`.
- Re-verification scheduling / decay (re-checking old `valid` verdicts on a timer).
