-- 003_lead_lifecycle.sql — extend lead lifecycle with meeting/improve/handover stages.
-- Adds columns for service-area, business hours, custom domain, handover mode, notes.

-- 1. New columns
alter table leads
    add column if not exists service_areas  jsonb default '[]'::jsonb,
    add column if not exists business_hours jsonb,
    add column if not exists custom_domain  text,
    add column if not exists handover_mode  text,
    add column if not exists notes          text;

-- 2. handover_mode value check
alter table leads
    drop constraint if exists leads_handover_mode_check;
alter table leads
    add constraint leads_handover_mode_check
    check (handover_mode is null or handover_mode in ('attach','transfer'));

-- 3. Replace stage check to include the new lifecycle values
alter table leads
    drop constraint if exists leads_stage_check;
alter table leads
    add constraint leads_stage_check
    check (stage in (
        'scraped','enriched','generated','deployed','outreached',
        'needs_email','replied','meeting_booked','meeting_done',
        'improved','handed_over','closed_won','closed_lost','dead'
    ));
