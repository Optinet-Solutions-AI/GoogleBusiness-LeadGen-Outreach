-- 017_category_off_niche.sql — Soft flag for "category doesn't match the niche".
--
-- The qualifier used to HARD-REJECT a lead when Google's category string
-- didn't contain a niche keyword (e.g. searching "personal trainer" rejected
-- every "gym" / "fitness_center" / "wellness_center" result). Google already
-- ranked those as relevant to the search, so rejecting them cut good leads.
--
-- Per the detect-don't-reject policy, category mismatch is now a FLAG, not a
-- kill: the lead still qualifies, and this column drives a "Category?" badge
-- so the operator can eyeball it.
--
-- Apply with: psql "$SUPABASE_URL" -f db/migrations/017_category_off_niche.sql

alter table leads add column if not exists category_off_niche bool not null default false;
