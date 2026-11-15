-- 061_ai_profile.sql — the last "AI profile" for a lead (lead page → AI profile button).
--
-- leads.ai_profile: what OpenAI web search found about the business, as shown in the AI profile window: a short
--   summary, what they do, owner / people, emails, phones, website, contact page, address, hours, socials,
--   services, founded, size, reviews and the source pages. Saved so reopening the window costs nothing.
-- leads.ai_profile_at: when it was made.
-- Additive + idempotent. Run in the Supabase SQL editor.

alter table leads add column if not exists ai_profile jsonb;
alter table leads add column if not exists ai_profile_at timestamptz;
