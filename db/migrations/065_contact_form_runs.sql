-- 065_contact_form_runs.sql — each "Contact form" attempt on a lead: the look (screenshot of their form) and the
-- real send (AI fills + submits once) with before/after screenshots (20 Nov 2026). Additive + idempotent.
-- Run in the Supabase SQL editor.

create table if not exists contact_form_runs (
    id               uuid primary key default gen_random_uuid(),
    lead_id          uuid not null references leads(id) on delete cascade,
    status           text not null default 'looking'
                     check (status in ('looking','ready','no_form','sending','sent','blocked','failed','unknown')),
    contact_url      text,
    form_shot_url    text,                 -- their form, before we touch it
    filled_shot_url  text,                 -- filled in, just before Send
    result_shot_url  text,                 -- their page after Send
    sender_email     text,
    sender_name      text,
    subject          text,
    message          text,
    offer_key        text,
    fields           jsonb,                -- [{name, value}] as filled
    reason           text,                 -- plain words: why blocked / failed
    usd              numeric(8,4),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    sent_at          timestamptz
);

create index if not exists contact_form_runs_lead_idx on contact_form_runs (lead_id, created_at desc);
