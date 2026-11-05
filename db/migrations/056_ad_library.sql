-- 056_ad_library.sql — competitor Ad Library: pull requests + one row per Meta Ad Library ad.
--
-- Used by /ads (workflows/build_ad_library.md). Additive + idempotent. Run in the Supabase SQL editor.
create table if not exists ad_pulls (
    id            uuid primary key default gen_random_uuid(),
    source        text not null default 'meta',
    source_url    text,                               -- Ad Library page / search URL, when given
    query         text,                               -- keyword search, when given
    country       text,                               -- ISO-2 for keyword searches
    media_type    text not null default 'all' check (media_type in ('all','video','image')),
    active_only   boolean not null default true,
    max_results   int  not null default 50,
    client_id     uuid references clients(id) on delete set null,   -- optional: pulled for this client
    status        text not null default 'queued' check (status in ('queued','running','done','failed')),
    found         int  not null default 0,
    cost_usd      numeric,
    last_error    text,
    started_at    timestamptz,
    finished_at   timestamptz,
    created_at    timestamptz not null default now()
);
alter table if exists ad_pulls disable row level security;
create index if not exists ad_pulls_created_idx on ad_pulls (created_at desc);

create table if not exists competitor_ads (
    id                uuid primary key default gen_random_uuid(),
    pull_id           uuid references ad_pulls(id) on delete set null,
    client_id         uuid references clients(id) on delete set null,
    source            text not null default 'meta',
    source_ad_id      text not null,                   -- Meta adArchiveID
    page_id           text,
    page_name         text,
    page_url          text,
    page_category     text,
    ad_library_url    text,                            -- https://www.facebook.com/ads/library/?id=<source_ad_id>
    title             text,
    body              text,
    link_url          text,
    link_description  text,
    cta_text          text,
    display_format    text,
    media_kind        text not null default 'unknown' check (media_kind in ('video','image','carousel','unknown')),
    image_urls        jsonb not null default '[]'::jsonb,   -- Meta CDN (expire)
    video_url         text,                                  -- Meta CDN HD (expires)
    thumbnail_url     text,                                  -- Meta CDN preview (expires)
    stored_thumbnail_url text,                               -- our Storage copy (made at pull time)
    stored_image_urls jsonb not null default '[]'::jsonb,    -- our Storage copies (made on Save)
    stored_video_url  text,                                  -- our Storage copy (made on Save)
    platforms         text[] not null default '{}',
    started_at        timestamptz,
    ended_at          timestamptz,
    is_active         boolean,
    saved             boolean not null default false,
    tags              text[] not null default '{}',
    notes             text,
    analysis          jsonb,                                 -- last Gemini analysis (hook, brief, script …)
    remakes           jsonb not null default '[]'::jsonb,    -- [{client_id, creative_id, at}]
    raw               jsonb,                                 -- the actor item, for fields we did not map
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (source, source_ad_id)
);
alter table if exists competitor_ads disable row level security;
create index if not exists competitor_ads_pull_idx on competitor_ads (pull_id);
create index if not exists competitor_ads_saved_idx on competitor_ads (saved, created_at desc);
create index if not exists competitor_ads_page_idx on competitor_ads (page_name);
