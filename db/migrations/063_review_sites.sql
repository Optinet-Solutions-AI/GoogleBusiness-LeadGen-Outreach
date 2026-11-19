-- 063_review_sites.sql — review-site leads (Trustpilot, TripAdvisor): the new sources, the 'review_site' signal,
-- the 'reputation' segment and the 'reputation_mgmt' offer. Also adds the 'exhibitor' segment, missing from the
-- call_segment check since 057 (exhibitor leads are routed to call_segment 'exhibitor').
--
-- Used by workflows/run_review_site_batch.md. Additive + idempotent: each check constraint is dropped by definition
-- match and re-added with the new values. Run in the Supabase SQL editor.
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
                    or pg_get_constraintdef(oid) ilike '%secondary_offer%'
                    or pg_get_constraintdef(oid) ilike '%call_segment%')
    loop
        execute format('alter table leads drop constraint if exists %I', c.conname);
    end loop;
end $$;
alter table batches add constraint batches_scraper_check
    check (scraper in ('apify','outscraper','google_places','warn','sec','exhibitors','trustpilot','tripadvisor'));
alter table leads add constraint leads_signal_type_check
    check (signal_type in ('closure','layoff','bankruptcy','listing','unspecified','exhibitor','review_site'));
alter table leads add constraint leads_primary_offer_check
    check (primary_offer in ('build_website','improve_website','voice_agent','buy_inventory','booth_build','reputation_mgmt'));
alter table leads add constraint leads_secondary_offer_check
    check (secondary_offer in ('build_website','improve_website','voice_agent','buy_inventory','booth_build','reputation_mgmt'));
alter table leads add constraint leads_call_segment_check
    check (call_segment in ('no_website','old_website','has_website','liquidation','exhibitor','reputation'));
