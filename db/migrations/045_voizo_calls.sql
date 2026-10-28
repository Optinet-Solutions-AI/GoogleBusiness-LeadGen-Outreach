-- 045_voizo_calls.sql — AI calls through Voizo (the "call" campaign channel).
--
-- Reuses the voice plumbing from 016/019 (call_attempts, leads.call_status,
-- campaign_leads, suppressions channel 'voice') and widens it for Voizo:
--   call_campaigns.channel  += 'call'
--   call_attempts           += Voizo call id, campaign, raw result fields,
--                              processed_at (idempotent finalize), status 'busy'/'canceled'/'unknown'
--   campaign_leads          += call_attempts / next_call_at / last_call_at (retry schedule)
--   leads.call_status       += 'qualified','not_interested','bad_number','failed','unknown'
--
-- Does NOT touch the leads.stage enum. Additive + idempotent. Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/045_voizo_calls.sql   (run by the operator)

-- ── call_campaigns: 'call' channel ────────────────────────────────────
alter table if exists call_campaigns drop constraint if exists call_campaigns_channel_check;
alter table if exists call_campaigns
  add constraint call_campaigns_channel_check
  check (channel in ('voice_agent','sms','dm','email','call'));

-- ── call_attempts: Voizo fields ───────────────────────────────────────
alter table call_attempts add column if not exists campaign_id      uuid references call_campaigns(id) on delete set null;
alter table call_attempts add column if not exists provider_call_id text;      -- Voizo callId (the only handle)
alter table call_attempts add column if not exists provider_status  text;      -- raw Voizo status
alter table call_attempts add column if not exists provider_outcome text;      -- raw Voizo outcome label
alter table call_attempts add column if not exists goal_reached     bool;
alter table call_attempts add column if not exists voicemail        bool;
alter table call_attempts add column if not exists ended_reason     text;
alter table call_attempts add column if not exists answered_at      timestamptz;
alter table call_attempts add column if not exists done             bool not null default false;
alter table call_attempts add column if not exists processed_at     timestamptz; -- set once by finalize (idempotency)
alter table call_attempts add column if not exists last_polled_at   timestamptz;

create unique index if not exists call_attempts_provider_call_idx
  on call_attempts(provider, provider_call_id) where provider_call_id is not null;
create index if not exists call_attempts_open_idx
  on call_attempts(provider) where processed_at is null;

alter table call_attempts drop constraint if exists call_attempts_status_check;
alter table call_attempts
  add constraint call_attempts_status_check
  check (status in ('queued','dialing','connected','no_answer','busy','voicemail',
                    'completed','failed','canceled','unknown'));

-- ── campaign_leads: per-member retry schedule ─────────────────────────
alter table campaign_leads add column if not exists call_attempts int not null default 0;
alter table campaign_leads add column if not exists next_call_at  timestamptz;
alter table campaign_leads add column if not exists last_call_at  timestamptz;
create index if not exists campaign_leads_next_call_idx on campaign_leads(next_call_at);

-- ── leads.call_status: Voizo result states ────────────────────────────
alter table leads drop constraint if exists leads_call_status_check;
alter table leads
  add constraint leads_call_status_check
  check (call_status in (
    'none','queued','dialing','attempted','connected',
    'no_answer','voicemail','completed','dnc',
    'qualified','not_interested','bad_number','failed','unknown'
  ));
