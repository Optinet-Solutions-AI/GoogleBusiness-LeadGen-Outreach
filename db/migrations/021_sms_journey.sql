-- 021_sms_journey.sql — the "connected journey": interested call → SMS one-time link → form → inbox.
--
-- Adds (all additive + idempotent):
--   leads.sms_status / inbox_status / inbox_owner — denormalized journey state for the dashboard
--   suppressions   — permanent, phone-keyed DNC/STOP ledger (survives lead deletion, cross-batch)
--   sms_messages   — outbound + inbound SMS system of record
--   form_links     — private one-time link (token HASHED at rest, single-use, expiring)
--   form_submissions — the short intake form answers
--   webhook_events — dedupe ledger for at-least-once provider delivery (SMS DLR / inbound)
--
-- Works end-to-end at $0: with no Mobivate key the SMS send soft-no-ops; the link/form/inbox are real.
-- Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/021_sms_journey.sql   (run by the operator)

-- ── leads: SMS + inbox status ──────────────────────────────────────────
alter table leads add column if not exists sms_status text not null default 'none'
    check (sms_status in ('none','queued','sent','delivered','failed','replied','opted_out'));
alter table leads add column if not exists inbox_status text not null default 'none'
    check (inbox_status in ('none','open','needs_reply','snoozed','closed'));
alter table leads add column if not exists inbox_owner text;
create index if not exists leads_inbox_status_idx on leads(inbox_status);

-- ── suppressions (permanent, phone-keyed) ──────────────────────────────
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

-- ── sms_messages (outbound + inbound system of record) ─────────────────
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

-- ── form_links (private one-time link; token hashed at rest) ───────────
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
-- only one live (issued/opened) link per lead → idempotent re-issue
create unique index if not exists form_links_active_per_lead
    on form_links(lead_id) where status in ('issued','opened');
alter table if exists form_links disable row level security;

-- ── form_submissions ───────────────────────────────────────────────────
create table if not exists form_submissions (
    id            uuid primary key default uuid_generate_v4(),
    lead_id       uuid not null references leads(id) on delete cascade,
    form_link_id  uuid references form_links(id) on delete set null,
    answers       jsonb not null default '{}',
    created_at    timestamptz not null default now()
);
create index if not exists form_submissions_lead_idx on form_submissions(lead_id);
alter table if exists form_submissions disable row level security;

-- ── webhook_events (dedupe ledger for at-least-once delivery) ──────────
create table if not exists webhook_events (
    id                 uuid primary key default uuid_generate_v4(),
    provider           text not null,
    provider_event_id  text not null,
    received_at        timestamptz not null default now(),
    payload            jsonb,
    unique (provider, provider_event_id)
);
alter table if exists webhook_events disable row level security;
