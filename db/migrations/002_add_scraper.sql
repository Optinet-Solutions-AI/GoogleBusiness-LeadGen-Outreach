-- 002_add_scraper.sql — add scraper switch + cost preview to batches.
-- Apply to any DB that was created from 001_initial.sql before this change.

alter table batches
    add column if not exists scraper text not null default 'google_places'
        check (scraper in ('outscraper','google_places')),
    add column if not exists estimated_cost_usd numeric(10,4);
