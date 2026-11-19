-- 064_templates_agents.sql — saved email templates with a full version history, and the Voizo voice agents the
-- operator can pick per AI call (19 Nov 2026). Additive + idempotent. Run in the Supabase SQL editor.
--
-- email_templates          — the current version of each saved template (archive, never delete)
-- email_template_versions  — every saved version (1, 2, …); restoring an old one saves it as a new version
-- voice_agents             — Voizo scripts (built in Voizo's Script Builder) we may dial with; one default
-- campaign_leads.voizo_campaign_id — the script chosen for that queued call (null = Voizo's default)

create table if not exists email_templates (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,
    service_key  text,                                   -- offer it's written for (website_build, …); null = any
    subject      text not null,
    body         text not null,
    follow_up_1  text not null default '',
    follow_up_2  text not null default '',
    version      int  not null default 1,
    archived     boolean not null default false,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table if not exists email_template_versions (
    id           uuid primary key default gen_random_uuid(),
    template_id  uuid not null references email_templates(id) on delete cascade,
    version      int  not null,
    name         text not null,
    service_key  text,
    subject      text not null,
    body         text not null,
    follow_up_1  text not null default '',
    follow_up_2  text not null default '',
    note         text,                                   -- e.g. "restored from version 2"
    created_at   timestamptz not null default now(),
    unique (template_id, version)
);
create index if not exists email_template_versions_template_idx on email_template_versions (template_id, version desc);

create table if not exists voice_agents (
    id                uuid primary key default gen_random_uuid(),
    name              text not null,
    voizo_campaign_id text not null unique,             -- the Voizo script (campaign) id, from Script Builder
    script_builder_url text,                            -- link to test / edit it in Voizo
    notes             text,
    is_default        boolean not null default false,
    archived          boolean not null default false,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

alter table campaign_leads add column if not exists voizo_campaign_id text;
