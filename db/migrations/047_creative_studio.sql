-- 047_creative_studio.sql — Creative Studio (month plans of branded posts from the Brand Brain).
--
-- Adds four tables:
--   content_plans, creatives, creative_versions, creative_reviews
-- plus indexes on every client_id / plan_id / creative_id / version_id, RLS disabled,
-- and set_updated_at triggers on content_plans / creatives.
-- Also re-creates the brand_assets origin check with 'render' added.
--
-- generation_jobs.kind values are documented in code (no check constraint); generation_jobs.provider
-- has no check constraint either, so 'openai' / 'chromium' need no change.
--
-- Additive + idempotent (requires set_updated_at(), uuid_generate_v4() and the 046 tables). Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/047_creative_studio.sql   (run by the operator)

-- ── content_plans: one month plan per client ──────────────────────────
create table if not exists content_plans (
    id                    uuid primary key default uuid_generate_v4(),
    client_id             uuid not null references clients(id) on delete cascade,
    month                 date not null,
    platforms             text[] not null,
    posts_per_week        int  not null check (posts_per_week between 1 and 5),
    product_ids           uuid[] not null default '{}',
    ai_backgrounds        bool not null default true,
    status                text not null default 'planning'
                          check (status in ('planning','generating','ready','done')),
    concepts              jsonb not null default '[]'::jsonb,
    estimate_usd          numeric,
    generating_started_at timestamptz,
    heartbeat_at          timestamptz,
    pending_count         int  not null default 0,
    last_error            text,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    unique (client_id, month)
);
create index if not exists content_plans_client_idx on content_plans(client_id);

-- ── creatives: one post (single image or carousel) ────────────────────
create table if not exists creatives (
    id              uuid primary key default uuid_generate_v4(),
    client_id       uuid not null references clients(id) on delete cascade,
    plan_id         uuid references content_plans(id) on delete set null,
    kind            text not null check (kind in ('image','carousel')),
    slot_date       date,
    platforms       text[] not null,
    template_key    text not null,
    product_id      uuid references brand_products(id) on delete set null,
    title           text,
    status          text not null default 'draft'
                    check (status in ('draft','rendering','ready','failed')),
    current_version int  not null default 0,
    concept_index   int,                                -- which plan concept this came from
    brief           text,                               -- single posts
    last_error      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists creatives_client_idx on creatives(client_id);
create index if not exists creatives_plan_idx on creatives(plan_id);

-- ── creative_versions: versioned copy + renders ───────────────────────
create table if not exists creative_versions (
    id          uuid primary key default uuid_generate_v4(),
    creative_id uuid not null references creatives(id) on delete cascade,
    client_id   uuid not null references clients(id) on delete cascade,
    version     int  not null,
    state       text not null default 'draft'
                check (state in ('draft','approved','changes_requested','rejected','superseded')),
    inputs      jsonb not null default '{}'::jsonb,
    copy        jsonb not null default '{}'::jsonb,
    grounding   jsonb not null default '{}'::jsonb,
    renders     jsonb not null default '[]'::jsonb,
    ai          jsonb not null default '{}'::jsonb,
    note        text,
    created_at  timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by text,
    unique (creative_id, version)
);
create index if not exists creative_versions_creative_idx on creative_versions(creative_id);
create index if not exists creative_versions_client_idx on creative_versions(client_id);
create unique index if not exists creative_versions_one_approved_idx
    on creative_versions(creative_id) where state = 'approved';

-- ── creative_reviews: audit trail of operator/client decisions ────────
create table if not exists creative_reviews (
    id         uuid primary key default uuid_generate_v4(),
    version_id uuid not null references creative_versions(id) on delete cascade,
    client_id  uuid not null references clients(id) on delete cascade,
    action     text not null check (action in ('approve','reject','request_changes','edit')),
    note       text,
    actor      text not null default 'operator',
    created_at timestamptz not null default now()
);
create index if not exists creative_reviews_version_idx on creative_reviews(version_id);
create index if not exists creative_reviews_client_idx on creative_reviews(client_id);

-- ── brand_assets.origin += 'render' ───────────────────────────────────
alter table brand_assets drop constraint if exists brand_assets_origin_check;
alter table brand_assets add constraint brand_assets_origin_check
    check (origin in ('upload','website','facebook','instagram','google_maps','lead','render'));

-- ── RLS off (like the rest of the schema) + updated_at triggers ───────
alter table if exists content_plans     disable row level security;
alter table if exists creatives         disable row level security;
alter table if exists creative_versions disable row level security;
alter table if exists creative_reviews  disable row level security;

drop trigger if exists content_plans_updated on content_plans;
create trigger content_plans_updated before update on content_plans
for each row execute function set_updated_at();

drop trigger if exists creatives_updated on creatives;
create trigger creatives_updated before update on creatives
for each row execute function set_updated_at();
