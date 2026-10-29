-- 049_liquidation_leads.sql — liquidation leads (slice 1: WARN closures).
--
-- Adds the free 'warn' scraper (US WARN closure/layoff notices), per-batch settings, the
-- lead signal columns, the 'liquidation' call segment and the 'buy_inventory' offer.
-- Additive + idempotent. Existing check constraints are dropped by definition match (not by name),
-- so a differently-named live constraint cannot make this fail. Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/049_liquidation_leads.sql   (run by the operator)

-- ── batches: allow 'warn' + per-batch settings ────────────────────────
do $$
declare c record;
begin
    for c in select conname from pg_constraint
             where conrelid = 'batches'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%scraper%'
    loop
        execute format('alter table batches drop constraint if exists %I', c.conname);
    end loop;
end $$;
alter table batches add constraint batches_scraper_check
    check (scraper in ('apify','outscraper','google_places','warn'));
alter table batches add column if not exists settings jsonb not null default '{}'::jsonb;

-- ── leads: signal columns ─────────────────────────────────────────────
alter table leads add column if not exists signal_type text
    check (signal_type in ('closure','layoff','bankruptcy','listing','unspecified'));
alter table leads add column if not exists signal_date date;
alter table leads add column if not exists signal_source_url text;
alter table leads add column if not exists signal_meta jsonb;

-- ── leads: 'liquidation' segment + 'buy_inventory' offer ──────────────
do $$
declare c record;
begin
    for c in select conname from pg_constraint
             where conrelid = 'leads'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%call_segment%'
    loop
        execute format('alter table leads drop constraint if exists %I', c.conname);
    end loop;
end $$;
alter table leads add constraint leads_call_segment_check
    check (call_segment in ('no_website','old_website','has_website','liquidation'));

do $$
declare c record;
begin
    for c in select conname from pg_constraint
             where conrelid = 'leads'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%primary_offer%'
    loop
        execute format('alter table leads drop constraint if exists %I', c.conname);
    end loop;
end $$;
alter table leads add constraint leads_primary_offer_check
    check (primary_offer in ('build_website','improve_website','voice_agent','buy_inventory'));

do $$
declare c record;
begin
    for c in select conname from pg_constraint
             where conrelid = 'leads'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%secondary_offer%'
    loop
        execute format('alter table leads drop constraint if exists %I', c.conname);
    end loop;
end $$;
alter table leads add constraint leads_secondary_offer_check
    check (secondary_offer in ('build_website','improve_website','voice_agent','buy_inventory'));
