-- 057_exhibitors.sql — conference-exhibitor leads: the 'exhibitors' source, the 'exhibitor' signal, the 'booth_build' offer.
--
-- Used by workflows/run_exhibitor_batch.md. Additive + idempotent: each check constraint is dropped by definition
-- match and re-added with the new value. Run in the Supabase SQL editor.
do $$
declare c record;
begin
    for c in select conname from pg_constraint
             where conrelid = 'batches'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%scraper%'
    loop
        execute format('alter table batches drop constraint if exists %I', c.conname);
    end loop;
    for c in select conname from pg_constraint
             where conrelid = 'leads'::regclass and contype = 'c'
               and (pg_get_constraintdef(oid) ilike '%signal_type%'
                    or pg_get_constraintdef(oid) ilike '%primary_offer%'
                    or pg_get_constraintdef(oid) ilike '%secondary_offer%')
    loop
        execute format('alter table leads drop constraint if exists %I', c.conname);
    end loop;
end $$;
alter table batches add constraint batches_scraper_check
    check (scraper in ('apify','outscraper','google_places','warn','sec','exhibitors'));
alter table leads add constraint leads_signal_type_check
    check (signal_type in ('closure','layoff','bankruptcy','listing','unspecified','exhibitor'));
alter table leads add constraint leads_primary_offer_check
    check (primary_offer in ('build_website','improve_website','voice_agent','buy_inventory','booth_build'));
alter table leads add constraint leads_secondary_offer_check
    check (secondary_offer in ('build_website','improve_website','voice_agent','buy_inventory','booth_build'));
