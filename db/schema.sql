-- schema.sql — Authoritative table definitions for the lead-gen pipeline.
-- Apply with: psql "$SUPABASE_URL" -f schema.sql
-- Migrations live in db/migrations/. Edit those, then port the change here.

create extension if not exists "uuid-ossp";

-- ─────────── batches ───────────
create table if not exists batches (
    id              uuid primary key default uuid_generate_v4(),
    niche           text   not null,
    city            text   not null,
    template_slug   text   not null default 'trades',
    scraper         text   not null default 'google_places'
                    check (scraper in ('outscraper','google_places')),
    country_code    text   not null default 'us',  -- ISO 3166-1 alpha-2 (lowercase); biases scraper region
    "limit"         int             default 100,
    status          text   not null default 'queued'
                    check (status in ('queued','running','done','failed')),
    estimated_cost_usd  numeric(10,4),  -- computed at create time, for the audit trail
    scraped_count       int default 0,  -- how many leads Google returned (set by orchestrator on completion)
    rejected_count      int default 0,  -- how many the qualifier filter rejected
    rejection_reasons   jsonb default '{}'::jsonb,  -- breakdown: { has_website: 40, low_rating: 15, ... }
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists batches_status_idx on batches(status);
create index if not exists batches_created_idx on batches(created_at desc);

-- ─────────── leads ───────────
create table if not exists leads (
    id              uuid primary key default uuid_generate_v4(),
    batch_id        uuid not null references batches(id) on delete cascade,

    -- raw scraped fields
    business_name   text not null,
    phone           text,
    address         text,
    category        text,
    rating          numeric(3,2),
    review_count    int,
    has_website     bool default false,
    website_url     text,                        -- raw URL Places returned (may be facebook.com/..., null when business has no online presence)
    website_kind    text                         -- derived enum: 'none' | 'real' | 'facebook' | 'instagram' | ... see migration 010
                    check (website_kind in (
                        'none','real',
                        'facebook','instagram','twitter','linkedin','tiktok','pinterest','youtube',
                        'yelp','yellowpages','foursquare','nextdoor','thumbtack','angi','bbb',
                        'linktree','beacons','about_me','carrd',
                        'sites_google','wix_free','weebly','webnode','blogspot','wordpress',
                        'other_social','other_aggregator','other_free_host'
                    )),
    website_is_live bool,                        -- null = unchecked; true = real site responded; false = parked/dead/timeout (flag only, not auto-rejected)
    business_status text                         -- Google's businessStatus. CLOSED_PERMANENTLY hard-rejects; CLOSED_TEMPORARILY is a flag.
                    check (business_status in (
                        'OPERATIONAL','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY'
                    )),
    is_service_area_only bool not null default false,  -- true when business has no fixed address (mobile / SAB)
    is_franchise_flagged bool not null default false,  -- true when business name matches a franchise keyword
    language_code   text,                              -- ISO 639-1; detected from review text
    place_id        text,
    latitude        numeric,
    longitude       numeric,
    country_code    text,                              -- ISO 3166-1 alpha-2 (lowercase); denormalized from batches.country_code



    -- enriched fields
    email           text,
    brand_color     text,
    logo_url        text,                        -- Brandfetch result OR monogram SVG data URI
    photos          jsonb default '[]'::jsonb,
    reviews         jsonb default '[]'::jsonb,
    service_areas   jsonb default '[]'::jsonb,   -- cities for /service-area page
    business_hours  jsonb,                       -- { mon: "8am-5pm", ... }

    -- qualifier filter result (set by stage 1)
    qualified         bool default true,         -- false → skipped by stage 2-4
    rejection_reason  text,                      -- e.g. 'has_website', 'rating<4.0'

    -- lifecycle suppression — leads in customer / unsubscribed / dnc are blocked from new batches
    lifecycle_stage text not null default 'prospect'
                    check (lifecycle_stage in (
                        'prospect','pitched','customer','unsubscribed','dnc','dead'
                    )),

    -- pipeline state
    stage           text not null default 'scraped'
                    check (stage in (
                        'scraped','enriched','generated','deployed','outreached',
                        'needs_email','replied','meeting_booked','meeting_done',
                        'improved','handed_over','closed_won','closed_lost','dead'
                    )),
    demo_url        text,
    custom_domain   text,                  -- attached at handover (e.g. joesplumbing.com)
    handover_mode   text                   -- 'attach' | 'transfer'
                    check (handover_mode in ('attach','transfer')),
    notes           text,                  -- operator scratch (meeting notes, requests)
    last_error      text,
    rebuild_started_at timestamptz,        -- set when "Rebuild" is clicked; cleared when stage 4 finishes. Drives the refresh-safe spinner.

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    unique (place_id, batch_id)
);

create index if not exists leads_batch_idx on leads(batch_id);
create index if not exists leads_stage_idx on leads(stage);
create index if not exists leads_email_idx on leads(email);
create index if not exists leads_country_code_idx on leads(country_code);

-- ─────────── outreach_events ───────────
create table if not exists outreach_events (
    id          uuid primary key default uuid_generate_v4(),
    lead_id     uuid not null references leads(id) on delete cascade,
    kind        text not null,
    meta        jsonb default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists outreach_events_lead_idx on outreach_events(lead_id);
create index if not exists outreach_events_kind_idx on outreach_events(kind);

-- ─────────── helpers ───────────
create or replace function count_leads_by_stage(p_batch_id uuid)
returns table (stage text, n bigint)
language sql stable as $$
    select stage, count(*)::bigint
    from leads
    where batch_id = p_batch_id
    group by stage
$$;

-- ─────────── Row-level security ───────────
-- This is a single-operator backend that talks to Supabase via the
-- SERVICE_ROLE key, which already bypasses RLS by design. Leaving RLS
-- on (Supabase enables it by default on new projects) just produces
-- confusing "violates row-level security policy" errors when a stale
-- anon key sneaks in. Explicitly disable so it can't bite us.
alter table if exists batches          disable row level security;
alter table if exists leads            disable row level security;
alter table if exists outreach_events  disable row level security;

-- updated_at trigger
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end$$;

drop trigger if exists batches_updated on batches;
create trigger batches_updated before update on batches
for each row execute function set_updated_at();

drop trigger if exists leads_updated on leads;
create trigger leads_updated before update on leads
for each row execute function set_updated_at();

-- ─────────── email_accounts ───────────
create table if not exists email_accounts (
    id                  uuid primary key default uuid_generate_v4(),
    email               text unique not null,
    from_name           text,
    provider            text,
    auth_type           text,
    email_provider      text,
    smtp_host           text,
    smtp_port           int,
    smtp_user           text,
    smtp_password       text,
    smtp_secure         text check (smtp_secure in ('ssl', 'tls')),
    imap_host           text,
    imap_port           int,
    imap_user           text,
    imap_pass           text,
    status              text not null default 'active'
                        check (status in ('active', 'paused', 'error')),
    daily_cap           int,
    hourly_cap          int,
    is_cold_sender      bool not null default true,
    warmup_enabled      bool not null default true,
    warmup_started_at   timestamptz,
    warmup_target_cap   int not null default 50,
    warmup_ramp_days    int not null default 21,
    created_at          timestamptz not null default now()
);

alter table if exists email_accounts disable row level security;
