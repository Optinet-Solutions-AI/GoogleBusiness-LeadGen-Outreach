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
    scraper         text   not null default 'apify'
                    check (scraper in ('apify','outscraper','google_places')),
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
    category_off_niche   bool not null default false,  -- true when Google's category didn't match the searched niche (flag, NOT a reject — migration 017)
    language_code   text,                              -- ISO 639-1; detected from review text
    place_id        text,
    latitude        numeric,
    longitude       numeric,
    country_code    text,                              -- ISO 3166-1 alpha-2 (lowercase); denormalized from batches.country_code

    -- campaign routing (migration 019)
    call_segment    text                               -- 3-segment routing: no_website | old_website | has_website
                    check (call_segment in ('no_website','old_website','has_website')),
    source          text not null default 'scraped'    -- lead origin: scraped | csv | manual
                    check (source in ('scraped','csv','manual')),

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
    rejection_reason  text,                      -- e.g. 'good_website', 'rating<4.0'

    -- website audit (migration 016) — populated for leads that HAVE a real
    -- website. Drives the build-vs-improve offer split.
    website_score      int,                       -- 0-100, higher = healthier; null = not audited
    website_issues     jsonb not null default '[]'::jsonb,  -- ['no_https','not_mobile',...]
    needs_improvement  bool,                      -- true → pitch improve_website
    audited_at         timestamptz,

    -- offer routing (migration 016) — which of the 3 offers to pitch.
    primary_offer   text                          -- build_website | improve_website | voice_agent
                    check (primary_offer in ('build_website','improve_website','voice_agent')),
    secondary_offer text                          -- universal attach (usually voice_agent)
                    check (secondary_offer in ('build_website','improve_website','voice_agent')),
    offer_locked    bool not null default false,  -- true → operator override; router won't re-stomp

    -- denormalized latest call state for the dashboard (system of record: call_attempts)
    call_status     text not null default 'none'
                    check (call_status in (
                        'none','queued','dialing','attempted','connected',
                        'no_answer','voicemail','completed','dnc'
                    )),

    -- denormalized SMS + inbox journey state (migration 021; system of record: sms_messages / form_links)
    sms_status      text not null default 'none'
                    check (sms_status in ('none','queued','sent','delivered','failed','replied','opted_out')),
    inbox_status    text not null default 'none'
                    check (inbox_status in ('none','open','needs_reply','snoozed','closed')),
    inbox_owner     text,

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
create index if not exists leads_primary_offer_idx on leads(primary_offer);
create index if not exists leads_call_status_idx on leads(call_status);
create index if not exists leads_call_segment_idx on leads(call_segment);
create index if not exists leads_inbox_status_idx on leads(inbox_status);

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

-- ─────────── call_attempts (migration 016) ───────────
-- System of record for outbound voice outreach. One row per call attempt.
-- The denormalized leads.call_status mirrors the latest attempt's state.
create table if not exists call_attempts (
    id            uuid primary key default uuid_generate_v4(),
    lead_id       uuid not null references leads(id) on delete cascade,
    offer_pitched text
                  check (offer_pitched in ('build_website','improve_website','voice_agent')),
    provider      text not null default 'manual',   -- 'manual' | 'vapi' | 'retell' | 'bland' | 'twilio'
    status        text not null default 'queued'
                  check (status in ('queued','dialing','connected','no_answer','voicemail','completed','failed')),
    outcome       text
                  check (outcome in ('interested','not_interested','callback','wrong_number','do_not_call')),
    duration_sec    int,
    scheduled_at    timestamptz,
    started_at      timestamptz,
    ended_at        timestamptz,
    recording_url   text,
    transcript      text,
    script_snapshot text,
    meta            jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index if not exists call_attempts_lead_idx on call_attempts(lead_id);
create index if not exists call_attempts_status_idx on call_attempts(status);

-- ─────────── call_campaigns (migration 019) ───────────
-- A saved calling job: picks leads by segment/source/filter and schedules them.
create table if not exists call_campaigns (
    id              uuid primary key default uuid_generate_v4(),
    name            text not null,
    source          text not null default 'app'
                    check (source in ('app','csv','manual')),
    segment         text
                    check (segment in ('no_website','old_website','has_website')),
    country_code    text,                              -- app source filter
    category        text,                              -- app source filter (null = any)
    batch_id        uuid references batches(id) on delete set null,
    target_count    int,
    call_days       int[] not null default '{1,2,3,4,5}',   -- 1=Mon..7=Sun
    call_start_hour int  not null default 9  check (call_start_hour between 0 and 23),
    call_end_hour   int  not null default 20 check (call_end_hour   between 0 and 23),
    timezone        text,                              -- IANA, derived from country_code
    status          text not null default 'draft'
                    check (status in ('draft','building','active','paused','done')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists call_campaigns_status_idx on call_campaigns(status);

-- ─────────── campaign_leads (migration 019) ───────────
-- Snapshot membership: which leads belong to a campaign + per-campaign call status.
create table if not exists campaign_leads (
    campaign_id uuid not null references call_campaigns(id) on delete cascade,
    lead_id     uuid not null references leads(id)          on delete cascade,
    status      text not null default 'pending'
                check (status in ('pending','called','interested','done','skipped')),
    added_at    timestamptz not null default now(),
    primary key (campaign_id, lead_id)
);
create index if not exists campaign_leads_lead_idx on campaign_leads(lead_id);

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
alter table if exists call_attempts    disable row level security;
alter table if exists call_campaigns   disable row level security;
alter table if exists campaign_leads   disable row level security;

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

drop trigger if exists call_campaigns_updated on call_campaigns;
create trigger call_campaigns_updated before update on call_campaigns
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

-- ─────────── test_calls ───────────
-- Persisted in-browser /test-call conversations (transcript + recording) so the whole team can
-- review them in the app instead of a local .txt download. See migration 020_test_calls.sql.
create table if not exists test_calls (
    id               uuid primary key default uuid_generate_v4(),
    vapi_call_id     text,
    agent_id         text,
    transcript       jsonb not null default '[]',
    recording_url    text,
    summary          text,
    duration_seconds int,
    created_at       timestamptz not null default now()
);
create index if not exists test_calls_created_at_idx on test_calls(created_at desc);
alter table if exists test_calls disable row level security;

-- ─────────── connected journey (migration 021) ───────────
-- interested call → SMS one-time link → short form → lead inbox. STOP/DNC suppression.

create table if not exists suppressions (
    id          uuid primary key default uuid_generate_v4(),
    lead_id     uuid references leads(id) on delete set null,
    phone_e164  text not null,
    channel     text not null default 'all' check (channel in ('voice','sms','all')),
    reason      text,
    created_at  timestamptz not null default now(),
    unique (phone_e164, channel)
);
alter table if exists suppressions disable row level security;

create table if not exists sms_messages (
    id              uuid primary key default uuid_generate_v4(),
    lead_id         uuid references leads(id) on delete cascade,
    direction       text not null default 'outbound' check (direction in ('outbound','inbound')),
    provider        text not null default 'mobivate',
    provider_msg_id text,
    to_number       text,
    from_number     text,
    body            text,
    status          text not null default 'queued'
                    check (status in ('queued','sent','delivered','failed','received')),
    cost_usd        numeric(10,4),
    dedupe_key      text,
    meta            jsonb,
    created_at      timestamptz not null default now(),
    unique (lead_id, dedupe_key)
);
create index if not exists sms_messages_lead_idx on sms_messages(lead_id);
create index if not exists sms_messages_provider_msg_idx on sms_messages(provider_msg_id);
alter table if exists sms_messages disable row level security;

create table if not exists form_links (
    id               uuid primary key default uuid_generate_v4(),
    lead_id          uuid not null references leads(id) on delete cascade,
    call_attempt_id  uuid references call_attempts(id) on delete set null,
    token_hash       text not null unique,
    status           text not null default 'issued'
                     check (status in ('issued','opened','submitted','expired','revoked')),
    expires_at       timestamptz not null,
    opened_at        timestamptz,
    consumed_at      timestamptz,
    issued_by        text,
    created_at       timestamptz not null default now()
);
create unique index if not exists form_links_active_per_lead
    on form_links(lead_id) where status in ('issued','opened');
alter table if exists form_links disable row level security;

create table if not exists form_submissions (
    id            uuid primary key default uuid_generate_v4(),
    lead_id       uuid not null references leads(id) on delete cascade,
    form_link_id  uuid references form_links(id) on delete set null,
    answers       jsonb not null default '{}',
    created_at    timestamptz not null default now()
);
create index if not exists form_submissions_lead_idx on form_submissions(lead_id);
alter table if exists form_submissions disable row level security;

create table if not exists webhook_events (
    id                 uuid primary key default uuid_generate_v4(),
    provider           text not null,
    provider_event_id  text not null,
    received_at        timestamptz not null default now(),
    payload            jsonb,
    unique (provider, provider_event_id)
);
alter table if exists webhook_events disable row level security;
