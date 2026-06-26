-- 038_disable_rls_campaigns.sql
-- call_campaigns + campaign_leads still had ROW LEVEL SECURITY enabled in the
-- live database, even though migration 019 intended it disabled. Every table in
-- this project runs RLS-disabled — all access is server-side via the Supabase
-- service key. With RLS left on, inserts failed with
--   "new row violates row-level security policy for table \"call_campaigns\"" (42501)
-- which surfaced as "campaign insert failed: new row vi…" when creating a
-- campaign. Re-assert the disable (idempotent).

alter table if exists call_campaigns disable row level security;
alter table if exists campaign_leads disable row level security;
