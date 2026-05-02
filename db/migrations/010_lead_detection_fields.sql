-- 010_lead_detection_fields.sql
--
-- Adds the columns needed for the broader "lead detection / enrichment" pass:
--   1. Persist the raw website URL Places hands us (we used to throw it away
--      and keep only has_website bool).
--   2. Capture Google's business_status so we can drop CLOSED listings before
--      enrichment burns Gemini quota on dead businesses.
--   3. Lifecycle suppression — track customers / unsubscribes / DNC so we
--      don't re-pitch them in a future batch.
--   4. Service-area / mobile-only flag for businesses without a fixed address.
--   5. Logo + language fields for the upcoming Brandfetch + i18n features.
--
-- All columns are nullable / defaulted so existing rows continue to satisfy
-- their constraints without a backfill.

alter table leads
    add column if not exists website_url            text,
    add column if not exists website_kind           text
        check (website_kind in (
            'none','real',
            'facebook','instagram','twitter','linkedin','tiktok','pinterest','youtube',
            'yelp','yellowpages','foursquare','nextdoor','thumbtack','angi','bbb',
            'linktree','beacons','about_me','carrd',
            'sites_google','wix_free','weebly','webnode','blogspot','wordpress',
            'other_social','other_aggregator','other_free_host'
        )),
    add column if not exists website_is_live        bool,             -- null = unchecked; true = real site responded; false = parked/dead/timeout
    add column if not exists business_status        text
        check (business_status in (
            'OPERATIONAL','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY'
        )),
    add column if not exists lifecycle_stage        text not null default 'prospect'
        check (lifecycle_stage in (
            'prospect','pitched','customer','unsubscribed','dnc','dead'
        )),
    add column if not exists language_code          text,             -- ISO 639-1, e.g. 'en','es','fr'
    add column if not exists is_service_area_only   bool not null default false,
    add column if not exists is_franchise_flagged   bool not null default false,
    add column if not exists logo_url               text;

-- Index lifecycle_stage so the suppression check at qualification time is cheap.
create index if not exists leads_lifecycle_idx on leads(lifecycle_stage);

-- A lead can already collide on (place_id, batch_id) from the unique
-- constraint in schema.sql (line 76). Add a second partial index so we can
-- look up "is this place_id ALREADY in our DB under any batch?" in O(1) when
-- doing cross-batch dedup at qualification time.
create index if not exists leads_place_id_global_idx
    on leads(place_id) where place_id is not null;
