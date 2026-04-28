# Workflow — Send outreach email (stage 5)

**Objective:** Hand a deployed lead off to Instantly.ai for personalized cold email.

## Inputs
- `lead` at `stage = 'deployed'` with `demo_url` and `email` populated
- An Instantly `campaign_id` configured in `stage-5-outreach.ts:DEFAULT_CAMPAIGN_ID`

## Tool
- `web/lib/pipeline/stage-5-outreach.ts` → `lib/services/instantly.ts`

## Steps
1. If `lead.email` is null → mark `stage = 'needs_email'`, skip.
2. POST `/leads` to Instantly with the campaign ID, email, business name, and `demo_url` as a custom variable.
3. Insert `outreach_events` row (`kind = email_sent`).
4. Update `lead.stage = 'outreached'`.

## Email sequence design (lives in Instantly UI, not in this repo)
1. Day 0 — short intro w/ demo URL ("I built this for you, take a look")
2. Day 3 — follow-up if no open ("did you see this?")
3. Day 7 — final nudge ("closing this out — last chance")

The skill `outreach-composer` helps draft + iterate the copy.

## Expected Outputs
- Lead in Instantly's campaign; opens/replies flow back via `/api/webhooks/instantly`.

## Known issues
- Instantly's API uses `personalization` for the templated link — check current docs as their schema has shifted twice.
- Sending domain must be warmed for 2–3 weeks before pilot launch or replies go to spam.
