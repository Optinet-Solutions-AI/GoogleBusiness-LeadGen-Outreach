-- 069_website_review.sql — the OpenAI website check (25 Nov 2026, operator decision).
--
-- During scraping (and on the lead page's "Check website again") OpenAI looks at a screenshot of the lead's homepage
-- plus what we measured and decides No / Old / Good website, with reasons, what to pitch and why, and the technical
-- checks. The verdict replaces John's manual Good / Old / No website dropdown.
--
--   website_review      — the last check: { verdict, score, summary, design, reasons[], pitch {offer, why, ideas[]},
--                         checks {...}, screenshot_url, model, usd, checked_at } plus, while a re-check runs,
--                         { pending_at } / after a failed one { error }.
--   website_reviewed_at — when the last finished check ran.
--
-- The code tolerates both missing (scraping keeps the free check; the lead page asks for this migration).

alter table leads add column if not exists website_review jsonb;
alter table leads add column if not exists website_reviewed_at timestamptz;
