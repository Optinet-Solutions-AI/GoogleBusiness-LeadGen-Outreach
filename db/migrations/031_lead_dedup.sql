-- 031_lead_dedup.sql
-- Duplicate detection for leads (same email, or same business+address across
-- scrapes). We FLAG duplicates rather than delete them — the operator decides
-- per-lead ("detect, don't auto-reject"). duplicate_of points at the surviving
-- "primary" lead; is_duplicate is the quick filter flag for the dashboard.
-- House style: idempotent; RLS disabled.

alter table if exists leads add column if not exists is_duplicate boolean not null default false;
alter table if exists leads add column if not exists duplicate_of uuid references leads(id);
create index if not exists leads_is_duplicate_idx on leads (is_duplicate);
create index if not exists leads_duplicate_of_idx on leads (duplicate_of);
