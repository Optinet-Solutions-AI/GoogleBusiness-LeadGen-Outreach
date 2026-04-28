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
    "limit"         int             default 100,
    status          text   not null default 'queued'
                    check (status in ('queued','running','done','failed')),
    estimated_cost_usd  numeric(10,4),  -- computed at create time, for the audit trail
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
    place_id        text,
    latitude        numeric,
    longitude       numeric,

    -- enriched fields
    email           text,
    brand_color     text,
    photos          jsonb default '[]'::jsonb,
    reviews         jsonb default '[]'::jsonb,
    service_areas   jsonb default '[]'::jsonb,   -- cities for /service-area page
    business_hours  jsonb,                       -- { mon: "8am-5pm", ... }

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

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    unique (place_id, batch_id)
);

create index if not exists leads_batch_idx on leads(batch_id);
create index if not exists leads_stage_idx on leads(stage);
create index if not exists leads_email_idx on leads(email);

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
