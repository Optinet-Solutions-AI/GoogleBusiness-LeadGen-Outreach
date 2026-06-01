-- 019_call_campaigns.sql — campaign-based calling + lead segment/source.
--
-- Adds:
--   leads.call_segment  — no_website | old_website | has_website (3-segment routing)
--   leads.source        — scraped | csv | manual (lead origin)
--   call_campaigns       — a saved calling job (segment + filters/source + schedule)
--   campaign_leads       — snapshot membership + per-campaign call status
--
-- Additive + idempotent. Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/019_call_campaigns.sql   (run by the operator)

-- ── leads: segment + source ───────────────────────────────────────────
alter table leads add column if not exists call_segment text
    check (call_segment in ('no_website','old_website','has_website'));
alter table leads add column if not exists source text not null default 'scraped'
    check (source in ('scraped','csv','manual'));
create index if not exists leads_call_segment_idx on leads(call_segment);

-- ── call_campaigns ────────────────────────────────────────────────────
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
    created_at      timestamptz not null default now()
);
create index if not exists call_campaigns_status_idx on call_campaigns(status);
alter table if exists call_campaigns disable row level security;

-- ── campaign_leads (snapshot membership) ──────────────────────────────
create table if not exists campaign_leads (
    campaign_id uuid not null references call_campaigns(id) on delete cascade,
    lead_id     uuid not null references leads(id)          on delete cascade,
    status      text not null default 'pending'
                check (status in ('pending','called','interested','done','skipped')),
    added_at    timestamptz not null default now(),
    primary key (campaign_id, lead_id)
);
create index if not exists campaign_leads_lead_idx on campaign_leads(lead_id);
alter table if exists campaign_leads disable row level security;
