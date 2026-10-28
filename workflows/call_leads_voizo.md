# Workflow — AI calls via Voizo (the "Call" campaign channel)

**Objective:** call a campaign's leads with Voizo's AI voice agent, one at a time,
and route every result back onto the lead, without ever re-calling someone who said
no, asked not to be called, or just said yes.

**Owner code:**
- `web/lib/services/voizo.ts`: the API client.
- `web/lib/calls/route-result.ts`: pure rules that decide what each result means for the lead.
- `web/lib/pipeline/call-scheduler.ts`: the worker.
- `web/lib/phone.ts`: E.164 formatting.

**Runs on:** Cloud Run `MODE=call`, fired every 15 min by the Cloud Scheduler job `voizo-call-tick`.

**Schema:** migration `045_voizo_calls.sql`.

---

## Division of labour

| Voizo owns | We own |
|---|---|
| placing one call, the script, the calling-hours window, the 100/day cap, one-at-a-time | who to call, order, retries, when to stop, follow-up, the lead's state |

Voizo **never** texts, emails, retries or calls us back. Everything we learn, we poll.

## Operator flow

1. **New campaign → channel "AI call"**. Only leads with a phone number are offered. Our voice
   do-not-call list (`suppressions`, channel `voice`/`all`) and `dnc`/`unsubscribed` leads are dropped.
2. Set the campaign's **days and hours**. These are checked in the campaign timezone on top of
   Voizo's own window, so a call only goes out when both are open.
3. Open the campaign and press **Activate**. The next tick starts dialling. **Pause** stops new
   dials right away; a call already ringing finishes and is still recorded.

## One tick (`runCallTick`)

```
0. Voizo not configured → no-op.
1. Reconcile: poll every unfinished Voizo call_attempt. Done → finalize.
   Older than 15 min and still not done → finalize as "unknown" (retryable).
2. Loop while ≥ 4 min of the tick budget remains (default budget 12 min):
   a. GET /status. shadow !== true → ABORT (never dial outside the shadow campaign).
      Not ready (window shut / cap hit / a call in flight) → stop the tick.
   b. Pick the next due member of an ACTIVE call campaign whose own window is open:
      status pending|called, next_call_at null or past, attempts < max.
      Gate the lead: phone formats to E.164; not suppressed; not GDPR-country;
      not already qualified / not_interested / bad_number / dnc.
   c. Claim it (next_call_at = now + 30 min) so a parallel tick can't take it too.
   d. POST /calls (never retried; a lost response would double-dial) → write call_attempts row + `call_placed`.
   e. Poll every 15 s until done (max 15 min, or until the tick budget ends;
      the next tick's reconcile step picks up an unfinished call).
   f. Finalize (below).
```

## Finalize is idempotent on the call

`call_attempts.processed_at` is claimed with a conditional update (`where processed_at is null`).
Only the caller that wins the claim writes the lead and member state and the event. Polling the same finished
call twice can never fire the handoff twice.

## Result routing (`routeCallResult`)

| Voizo result | Member (`campaign_leads.status`) | `leads.call_status` | Other effects | Event |
|---|---|---|---|---|
| `goalReached: true` | `interested` | `qualified` | stop email sequence · `inbox_status=needs_reply` (shows in the Inbox for a human to follow up) | `call_qualified` |
| `not_interested` / `declined_offer` | `done` | `not_interested` | stop email sequence · never re-queued | `call_declined` |
| `wrong_number` | `done` | `bad_number` | never re-queued | `call_bad_number` |
| `no_answer` / `busy` / `voicemail` / `failed` / `canceled` / unknown | `called`, retry in 24 h, until 3 attempts, then `done` | `no_answer` · `voicemail` · `failed` · `unknown` | — | `call_unreached` |

**Qualified is not won.** `goalReached` is a model's reading of a call. The lead's
pipeline `stage` is untouched. A human listens and follows up from the Inbox. There is
**no automatic follow-up send** yet. That is deliberate for the first batch (see the brief:
"put a person in the loop"). Wire one in only after ~20 goal-reached calls have been reviewed.

## Dial refusals (`classifyDialRefusal`)

| Code | Action |
|---|---|
| `suppressed` (409) | add phone to `suppressions` (channel `voice`) · `call_status=dnc` · member `skipped` · never retried |
| `invalid_phone` (400) | `call_status=bad_number` · member `skipped` |
| `already_in_progress` (409) | release lead (retry in 1 h), try the next |
| `busy` (429) | release lead, end the tick (a call is live) |
| `daily_cap_reached` / `outside_call_window` (429) | release lead, end the tick |
| `provider_error` (502) | counts as an attempt; retry on the 24 h schedule |
| `*_unverifiable` / `db_error` (503) | release lead (NOT called), end the tick |
| `campaign_unusable` (409) / `unauthorized` (401) / `bad_request` | **ABORT**: release lead, log error; tell Chris. Retrying won't help |
| network error / no response | the call **may** have been placed: record an `unknown` attempt, retry on the 24 h schedule (never re-dial at once) |

## Setup (once)

1. Voizo side is done by Chris: shadow test campaign, `source='api'`, Draft.
2. Add `VOIZO_API_KEY` to the repo-root `.env` (+ Vercel env for the dashboard status panel).
   Optional: `VOIZO_API_BASE`, `VOIZO_MAX_ATTEMPTS`, `VOIZO_RETRY_HOURS`, `CALL_TICK_BUDGET_MINUTES`.
3. Apply `db/migrations/045_voizo_calls.sql`.
4. Redeploy the job (`bash scripts/deploy-cloud-run-job.sh`, which syncs `VOIZO_API_KEY` to Secret Manager).
5. Create the scheduler (operator, once):
   ```
   gcloud scheduler jobs create http voizo-call-tick --location=us-central1 \
     --schedule="*/15 * * * *" --http-method=POST \
     --uri="https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/us-central1/jobs/lead-batch-runner:run" \
     --message-body='{"overrides":{"containerOverrides":[{"env":[{"name":"MODE","value":"call"}]}]}}' \
     --oauth-service-account-email="$GCP_SERVICE_ACCOUNT_EMAIL"
   ```
   Pause all calling: `gcloud scheduler jobs pause voizo-call-tick --location=us-central1`.

## Before the first live call (checklist from the Voizo brief)

`npx tsx scripts/voizo-check.ts` checks status only. `--dial=+1... --name=Chris` dials ONE number and polls it.

- [ ] status shows `ready: true` **and** `shadow: true`
- [ ] dial your own mobile; the agent greets you by the name you sent
- [ ] no SMS and no email arrive from Voizo
- [ ] the call is not on Voizo's dashboard / Campaigns / Live Activity
- [ ] the call reaches `done: true` with a sane `outcome`
- [ ] `--dial=+123` is refused `400 invalid_phone`
- [ ] a second dial while one is live returns `429 busy`
- [ ] polling a finished call twice does not fire the handoff twice (covered by `processed_at`)
