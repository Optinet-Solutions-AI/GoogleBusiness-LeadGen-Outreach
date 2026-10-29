-- 050_sec_scraper.sql — allow the free 'sec' scraper (SEC EDGAR bankruptcy / facility-closure 8-Ks).
-- Additive + idempotent; drops the scraper check by definition match, then re-adds it. Run in the Supabase SQL editor.
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
    check (scraper in ('apify','outscraper','google_places','warn','sec'));
