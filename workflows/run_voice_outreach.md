# Workflow — Voice outreach (3-offer, channel-agnostic)

> SOP for reaching a qualified lead **by phone** and pitching the best-fit
> offer. Email is retired; phone is the only outreach channel.
> No live voice agent yet — a human (or a future voice agent) reads the
> generated script and logs the outcome. The structure is built so a voice
> provider (Vapi/Retell/Bland/Twilio) plugs into one interface later.

## The three offers

| Offer | Pitch | Who gets it |
|-------|-------|-------------|
| `build_website` | "We built you a free demo site — here's the link." | no real website |
| `improve_website` | "Your current site is dated — here's a modern version we mocked up." | real site that scored `needs_improvement` |
| `voice_agent` | "An AI receptionist that answers every call 24/7." | universal **secondary/attach** offer on every kept lead |

Routing is automatic (`web/lib/offers.ts` → `routeOffer`) and shown as a
dashboard badge. The operator can override the primary offer per lead
(sets `offer_locked = true` so the pipeline won't re-stomp it).

## Lifecycle (calls are tracked separately from `leads.stage`)

```
deployed ──[operator clicks "Call"]──> stage-5-call.ts
   • generate per-offer script (call-script.ts, Gemini)
   • create call_attempts row (provider=manual → status='queued')
   • leads.call_status = 'queued'
        │
   operator works the Call Queue: reads script, dials, logs outcome
        │
   POST /api/leads/:id/call/outcome
   • call_attempts.outcome = interested | not_interested | callback | wrong_number | do_not_call
   • leads.call_status updated; outreach_events row written
        │
   if interested → operator moves lead to meeting_booked (existing lifecycle)
   if do_not_call → leads.lifecycle_stage = 'dnc'
```

`leads.stage` enum is unchanged. Call state lives on `call_attempts`
(system of record) + a denormalized `leads.call_status` for the dashboard.

## Required inputs

| Input | Source |
|-------|--------|
| `phone` | `leads.phone` (qualification already requires it) |
| `primary_offer` / `secondary_offer` | set by the router in stage 1/2 |
| business facts | `business_name`, `category`, `address`, `rating`, `review_count`, `demo_url`, `website_issues` |

## Tools

- `web/lib/services/call-script.ts` → `generateCallScript(lead, offer)` —
  Gemini, free tier. Returns `{ opener, value_prop, objections[], cta }`.
  Mirrors the prompt+retry pattern in `gemini.ts`.
- `web/lib/services/voice/index.ts` → `getVoiceProvider()` — env-driven
  factory; defaults to the **manual** provider (no external call, just
  queues the attempt). A real provider implements the same `VoiceProvider`
  interface in `voice/types.ts`.
- `web/lib/pipeline/stage-5-call.ts` → `run(lead)` — generates the script,
  creates the `call_attempt`, sets `call_status`. Idempotent: re-running
  reuses the open (queued) attempt instead of stacking duplicates.

## Edge cases / learnings

- **No phone** should never happen (qualifier requires it) — but guard:
  stage-5-call skips and logs if `phone` is null.
- **Re-run safety**: one open (`queued`/`dialing`) attempt per lead at a
  time. A new call request while one is open returns the existing attempt.
- **Provider swap**: adding Vapi/Retell means a new file implementing
  `VoiceProvider` + an env flag — no pipeline/route/UI changes.
- **Cost**: script generation is Gemini free-tier (~$0). The manual provider
  is free. A paid voice provider's per-minute cost gets a placeholder line
  in `pricing.ts` for when it goes live.
- Never auto-dial in bulk without operator confirmation (same discipline as
  paid scrape/build stages).
