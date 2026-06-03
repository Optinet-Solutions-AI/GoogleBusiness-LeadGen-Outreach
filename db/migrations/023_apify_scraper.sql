-- 023_apify_scraper.sql — add Apify as a scraper option + make it the new default.
--
-- Apify returns Google Maps data + website-crawled emails + FB/IG socials in one pass, is ~17x
-- cheaper than Google Places for leads-with-email, and (unlike Places) the data is ours to store
-- + market. Places + Outscraper stay selectable.
--
-- Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/023_apify_scraper.sql   (run by the operator)

-- Allow 'apify' in the scraper check, and flip the default to it.
alter table batches drop constraint if exists batches_scraper_check;
alter table batches add constraint batches_scraper_check
    check (scraper in ('apify','outscraper','google_places'));
alter table batches alter column scraper set default 'apify';
