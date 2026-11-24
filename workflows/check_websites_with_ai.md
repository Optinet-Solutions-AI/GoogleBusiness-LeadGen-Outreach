# Check a lead's website with AI

**Owner code:** `web/lib/leads/website-review.ts` (pure rules: verdict → pitch, the checks shown, prompt + schema),
`web/lib/services/website-review.ts` (open the homepage, screenshot, measure, ask OpenAI),
`web/lib/leads/website-recheck{,-run}.ts` + `app/api/leads/[id]/website-review/route.ts` (the button),
Cloud Run `MODE=website-review`. Migration **069**. Operator decision, 25 Nov 2026.

## Why

The free check (https / phone layout tag / speed / copyright year) was too often wrong, so the pitch was wrong. Now
OpenAI looks at the homepage the way a customer would and decides. John's manual Good / Old / No website dropdown
is gone: the AI's verdict decides the pitch.

## When it runs

- **During scraping**, on every lead with a real website (up to `WEBSITE_AI_MAX_PER_BATCH`, default 100, 0 = off),
  after the free check. Skipped for a parked or dead site (the free check already knows). About 1 cent a site; the
  batch estimate has a line for it. OpenAI down → the free check's result stays.
- **"Check website again"** on the lead page (Website check box): runs it for one lead on Cloud Run, about a
  minute. Refused for closing / exhibitor / review-site leads (never pitched a website), leads with no website, and
  while a check is already running (under 3 minutes).

## What it does

1. Opens the homepage in headless Chromium (images on), measures: https, phone layout tag, load time, newest year
   on the page, contact form, online booking (words or a booking tool), site builder, title.
2. Screenshots the top of the homepage (1280×1600 JPEG) → public bucket `lead-screenshots/website-reviews/`.
3. One OpenAI call (`OPENAI_WEBSITE_MODEL`, default `gpt-5.4-mini`) with the screenshot, the measurements and the page
   text → No / Old / Good website, a score, a one-line summary, how it looks, up to 6 reasons, why to pitch and up
   to 4 ideas. Not really their site (parked, coming soon, directory) → No website.
4. Saves `leads.website_review` + `website_reviewed_at`; the verdict sets `has_website` / `needs_improvement` /
   `website_score` / `website_issues`, and routing follows (No → new website, Old → redesign, Good → AI services).
   A re-check also hands routing back from an old manual choice (`offer_locked` off).

Typing a new website on the Contact card clears the old check; press **Check website again**.

## When it fails

- "needs database update 069" → run `db/migrations/069_website_review.sql` in Supabase.
- "Their website didn't load…" → the site blocked or timed out; open it yourself, try again later.
- Button says the worker isn't available → Cloud Run isn't set up locally; use the deployed app. The Cloud Run job
  must be redeployed once for `MODE=website-review`.
