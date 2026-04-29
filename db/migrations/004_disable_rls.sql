-- 004_disable_rls.sql — turn off RLS on operator-facing tables.
--
-- Why: this is a single-operator backend that talks to Supabase via the
-- SERVICE_ROLE key. Service-role bypasses RLS automatically, so RLS adds
-- no security here — but Supabase enables it by default on new tables,
-- and any time a stale anon key sneaks in, every insert/update fails
-- with "violates row-level security policy".
--
-- Apply with: copy + paste into the Supabase SQL editor and click Run.

alter table if exists batches          disable row level security;
alter table if exists leads            disable row level security;
alter table if exists outreach_events  disable row level security;
