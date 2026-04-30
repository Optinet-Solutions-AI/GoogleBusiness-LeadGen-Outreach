-- 008_country_code.sql — record which country a batch was scraped against,
-- so the scraper can bias results to that region (Google Places `regionCode`,
-- Outscraper `region`).
--
-- Before: country was implicit in the city string ("Mobile, AL"). The Places
-- env-var default (`us`) was always applied, so picking a city in another
-- country biased results back to the US — no useful AU/CA/etc. results.
--
-- After: batches.country_code is an ISO 3166-1 alpha-2 code (lowercase),
-- defaulting to 'us' so existing rows stay valid.

alter table batches
    add column if not exists country_code text not null default 'us';
