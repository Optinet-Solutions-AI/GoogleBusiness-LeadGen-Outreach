-- 049_liquidation_leads.sql — liquidation leads (slice 1: WARN closures).
--
-- Adds the free 'warn' scraper (US WARN closure/layoff notices), per-batch settings, the
-- lead signal columns, the 'liquidation' call segment and the 'buy_inventory' offer.
-- Additive + idempotent. Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/049_liquidation_leads.sql   (run by the operator)

-- ── batches: allow 'warn' + per-batch settings ────────────────────────
alter table batches drop constraint if exists batches_scraper_check;
alter table batches add constraint batches_scraper_check
    check (scraper in ('apify','outscraper','google_places','warn'));
alter table batches add column if not exists settings jsonb not null default '{}'::jsonb;

-- ── leads: signal columns ─────────────────────────────────────────────
alter table leads add column if not exists signal_type text
    check (signal_type in ('closure','layoff','bankruptcy','listing'));
alter table leads add column if not exists signal_date date;
alter table leads add column if not exists signal_source_url text;
alter table leads add column if not exists signal_meta jsonb;

-- ── leads: 'liquidation' segment + 'buy_inventory' offer ──────────────
alter table leads drop constraint if exists leads_call_segment_check;
alter table leads add constraint leads_call_segment_check
    check (call_segment in ('no_website','old_website','has_website','liquidation'));

alter table leads drop constraint if exists leads_primary_offer_check;
alter table leads add constraint leads_primary_offer_check
    check (primary_offer in ('build_website','improve_website','voice_agent','buy_inventory'));

alter table leads drop constraint if exists leads_secondary_offer_check;
alter table leads add constraint leads_secondary_offer_check
    check (secondary_offer in ('build_website','improve_website','voice_agent','buy_inventory'));
