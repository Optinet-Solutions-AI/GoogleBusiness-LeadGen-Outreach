-- 025_email_messages.sql
-- Real email threads for the Inbox: store every outbound + inbound email so a
-- lead's conversation (sent → replied) can be shown as a thread.
--
-- Inbound rows are fetched from IMAP by POST /api/email/sync and matched to a
-- lead by sender address (from_addr = leads.email). Outbound rows are written
-- by lib/pipeline/stage-5-email.ts when a send fires.
--
-- House style: idempotent (add ... if not exists), RLS disabled (service-role key).

-- Track IMAP sync position per mailbox so we only fetch new messages.
alter table if exists email_accounts add column if not exists imap_last_uid bigint;
alter table if exists email_accounts add column if not exists imap_last_synced_at timestamptz;

create table if not exists email_messages (
    id               uuid primary key default uuid_generate_v4(),
    lead_id          uuid references leads(id) on delete cascade,
    email_account_id uuid references email_accounts(id) on delete set null,
    direction        text not null default 'outbound'
                     check (direction in ('outbound', 'inbound')),
    message_id       text,            -- RFC822 Message-ID
    in_reply_to      text,            -- threading hint
    from_addr        text,
    to_addr          text,
    subject          text,
    body_text        text,
    body_snippet     text,            -- first ~200 chars for the list view
    provider_uid     text,            -- IMAP UID (dedupe inbound per mailbox)
    status           text not null default 'received'
                     check (status in ('sent', 'failed', 'received')),
    created_at       timestamptz not null default now()
);

create index if not exists email_messages_lead_idx
    on email_messages (lead_id, created_at desc);
create index if not exists email_messages_direction_idx
    on email_messages (direction, created_at desc);
-- Dedupe inbound fetches: one row per (mailbox, IMAP UID).
create unique index if not exists email_messages_uid_uq
    on email_messages (email_account_id, provider_uid)
    where provider_uid is not null;

alter table if exists email_messages disable row level security;
