-- 076_lead_score.sql — OpenAI lead score (27 Nov 2026): 0–100, band, reasons, what's holding it back.
--
-- lead_score         the number, in its own column so the Leads list can sort by it (nulls last).
-- lead_score_detail  { score, band, reasons[], holding_back, model, usd, scored_at }.
-- lead_scored_at     when it was scored ("Score again" waits 2 minutes after this).
--
-- The app tolerates these missing: scraping saves without them, lists show "—". workflows/score_leads.md.
alter table leads add column if not exists lead_score int;
alter table leads add column if not exists lead_score_detail jsonb;
alter table leads add column if not exists lead_scored_at timestamptz;
create index if not exists leads_lead_score_idx on leads (lead_score desc nulls last);
