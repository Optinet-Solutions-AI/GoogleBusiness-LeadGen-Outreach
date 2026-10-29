-- 046_clients_brand_brain.sql — Clients + Brand Brain (versioned, sourced business profile).
--
-- Adds seven tables:
--   clients, client_sources, source_pages, brand_profiles, brand_products,
--   brand_assets, generation_jobs
-- plus indexes on every client_id, RLS disabled, and set_updated_at triggers on
-- clients / client_sources / brand_products.
--
-- Does NOT touch existing tables or the leads.stage enum. Additive + idempotent
-- (requires set_updated_at() and uuid_generate_v4(), both from schema.sql). Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/046_clients_brand_brain.sql   (run by the operator)

-- ── clients ───────────────────────────────────────────────────────────
create table if not exists clients (
    id               uuid primary key default uuid_generate_v4(),
    lead_id          uuid unique references leads(id) on delete set null,
    name             text not null,
    status           text not null default 'pilot'
                     check (status in ('pilot','active','paused','churned')),
    website_url      text,
    country_code     text,
    timezone         text,
    notes            text,
    brain_started_at timestamptz,
    current_version  int  not null default 0,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create index if not exists clients_status_idx on clients(status);

-- ── client_sources: where a client's facts come from ──────────────────
create table if not exists client_sources (
    id              uuid primary key default uuid_generate_v4(),
    client_id       uuid not null references clients(id) on delete cascade,
    kind            text not null
                    check (kind in ('website','demo_site','facebook','instagram','google_maps','operator')),
    url             text,
    status          text not null default 'new'
                    check (status in ('new','crawled','partial','blocked','failed')),
    last_crawled_at timestamptz,
    last_error      text,
    page_count      int,
    intake          jsonb,                              -- operator kind only
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists client_sources_client_idx on client_sources(client_id);
create unique index if not exists client_sources_unique_idx
    on client_sources(client_id, kind, coalesce(url, ''));

-- ── source_pages: crawled page text ───────────────────────────────────
create table if not exists source_pages (
    id         uuid primary key default uuid_generate_v4(),
    source_id  uuid not null references client_sources(id) on delete cascade,
    client_id  uuid not null references clients(id) on delete cascade,
    url        text not null,
    title      text,
    text       text,
    fetched_at timestamptz not null default now()
);
create index if not exists source_pages_source_idx on source_pages(source_id);
create index if not exists source_pages_client_idx on source_pages(client_id);

-- ── brand_profiles: versioned brand brain ─────────────────────────────
create table if not exists brand_profiles (
    id         uuid primary key default uuid_generate_v4(),
    client_id  uuid not null references clients(id) on delete cascade,
    version    int  not null,
    written_by text not null check (written_by in ('ai','operator')),
    state      text not null
               check (state in ('current','superseded','pending_review','discarded')),
    note       text,
    data       jsonb not null default '{}'::jsonb,
    job_id     uuid,
    created_at timestamptz not null default now(),
    unique (client_id, version)
);
create index if not exists brand_profiles_client_idx on brand_profiles(client_id);
create unique index if not exists brand_profiles_one_current_idx
    on brand_profiles(client_id) where state = 'current';

-- ── brand_products ────────────────────────────────────────────────────
create table if not exists brand_products (
    id          uuid primary key default uuid_generate_v4(),
    client_id   uuid not null references clients(id) on delete cascade,
    name        text not null,
    description text,
    price       text,
    category    text,
    featured    bool not null default false,
    sort        int  not null default 0,
    source      jsonb,
    confirmed   bool not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists brand_products_client_idx on brand_products(client_id);

-- ── brand_assets: logos / photos / videos / documents ─────────────────
create table if not exists brand_assets (
    id           uuid primary key default uuid_generate_v4(),
    client_id    uuid not null references clients(id) on delete cascade,
    product_id   uuid references brand_products(id) on delete set null,
    kind         text not null check (kind in ('logo','photo','video','document')),
    origin       text not null
                 check (origin in ('upload','website','facebook','instagram','google_maps','lead')),
    status       text not null default 'ready'
                 check (status in ('pending','ready')),   -- pending = signed URL issued, not completed
    storage_path text,
    public_url   text,
    width        int,
    height       int,
    bytes        bigint,
    alt          text,
    tags         text[] not null default '{}',
    source_url   text,
    created_at   timestamptz not null default now()
);
create index if not exists brand_assets_client_idx on brand_assets(client_id);
create index if not exists brand_assets_product_idx on brand_assets(product_id);

-- ── generation_jobs: AI calls + cost ──────────────────────────────────
create table if not exists generation_jobs (
    id                uuid primary key default uuid_generate_v4(),
    client_id         uuid not null references clients(id) on delete cascade,
    kind              text not null,
    provider          text not null default 'gemini',
    model             text,
    status            text not null default 'running'
                      check (status in ('running','done','failed')),
    input             jsonb,
    output            jsonb,
    prompt_tokens     int,
    completion_tokens int,
    cost_usd          numeric,
    error             text,
    started_at        timestamptz not null default now(),
    finished_at       timestamptz
);
create index if not exists generation_jobs_client_idx on generation_jobs(client_id);

-- ── RLS off (like the rest of the schema) + updated_at triggers ───────
alter table if exists clients          disable row level security;
alter table if exists client_sources   disable row level security;
alter table if exists source_pages     disable row level security;
alter table if exists brand_profiles   disable row level security;
alter table if exists brand_products   disable row level security;
alter table if exists brand_assets     disable row level security;
alter table if exists generation_jobs  disable row level security;

drop trigger if exists clients_updated on clients;
create trigger clients_updated before update on clients
for each row execute function set_updated_at();

drop trigger if exists client_sources_updated on client_sources;
create trigger client_sources_updated before update on client_sources
for each row execute function set_updated_at();

drop trigger if exists brand_products_updated on brand_products;
create trigger brand_products_updated before update on brand_products
for each row execute function set_updated_at();
