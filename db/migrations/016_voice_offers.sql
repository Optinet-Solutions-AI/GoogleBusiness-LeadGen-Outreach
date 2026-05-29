-- 016_voice_offers.sql — Voice-first outreach + 3-offer routing + website audit.
--
-- Adds:
--   leads.website_score / website_issues / needs_improvement / audited_at
--        — output of the new website auditor (web/lib/services/website-auditor.ts)
--   leads.primary_offer / secondary_offer / offer_locked
--        — which of the 3 offers (build_website / improve_website / voice_agent)
--          to pitch; offer_locked=true means an operator override the router
--          must not re-stomp.
--   leads.call_status
--        — denormalized latest call state for the dashboard call queue.
--   call_attempts table
--        — system of record for outbound calls (one row per attempt).
--
-- Does NOT touch the leads.stage enum (build/deploy lifecycle unchanged).
-- Email outreach (stage-5-outreach + Instantly) is deprecated in code, not
-- dropped here — old needs_email/replied history stays readable.
--
-- Apply with: psql "$SUPABASE_URL" -f db/migrations/016_voice_offers.sql

-- ── leads: website audit ──────────────────────────────────────────────
alter table leads add column if not exists website_score     int;
alter table leads add column if not exists website_issues     jsonb not null default '[]'::jsonb;
alter table leads add column if not exists needs_improvement  bool;
alter table leads add column if not exists audited_at         timestamptz;

-- ── leads: offer routing ──────────────────────────────────────────────
alter table leads add column if not exists primary_offer   text
    check (primary_offer in ('build_website','improve_website','voice_agent'));
alter table leads add column if not exists secondary_offer text
    check (secondary_offer in ('build_website','improve_website','voice_agent'));
alter table leads add column if not exists offer_locked    bool not null default false;

-- ── leads: denormalized call state (system of record is call_attempts) ─
alter table leads add column if not exists call_status text not null default 'none'
    check (call_status in (
        'none','queued','dialing','attempted','connected',
        'no_answer','voicemail','completed','dnc'
    ));

create index if not exists leads_primary_offer_idx on leads(primary_offer);
create index if not exists leads_call_status_idx   on leads(call_status);

-- ── call_attempts ─────────────────────────────────────────────────────
create table if not exists call_attempts (
    id            uuid primary key default uuid_generate_v4(),
    lead_id       uuid not null references leads(id) on delete cascade,
    offer_pitched text                        -- build_website | improve_website | voice_agent
                  check (offer_pitched in ('build_website','improve_website','voice_agent')),
    provider      text not null default 'manual',   -- 'manual' now; 'vapi'/'retell'/'bland'/'twilio' later
    status        text not null default 'queued'
                  check (status in ('queued','dialing','connected','no_answer','voicemail','completed','failed')),
    outcome       text                        -- null until logged
                  check (outcome in ('interested','not_interested','callback','wrong_number','do_not_call')),
    duration_sec   int,
    scheduled_at   timestamptz,
    started_at     timestamptz,
    ended_at       timestamptz,
    recording_url  text,
    transcript     text,
    script_snapshot text,                      -- the script that was generated for this attempt
    meta           jsonb not null default '{}'::jsonb,   -- provider payload
    created_at     timestamptz not null default now()
);

create index if not exists call_attempts_lead_idx    on call_attempts(lead_id);
create index if not exists call_attempts_status_idx  on call_attempts(status);

alter table if exists call_attempts disable row level security;
