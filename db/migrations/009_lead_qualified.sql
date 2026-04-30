-- 009_lead_qualified.sql — record the qualifier filter result on every
-- scraped lead, so the operator can see WHY each lead got rejected
-- (currently rejected leads are dropped and operators only see counts).
--
-- These columns were already in schema.sql line 55-56 but the live DB
-- predates that. After migrating, stage-1-scrape persists every lead
-- (qualified or not) and the batch detail page can render "Sarah's
-- Estate Sales — rejected: had a real website" instead of just a count.

alter table leads
    add column if not exists qualified        bool default true,
    add column if not exists rejection_reason text;

-- Backfill existing rows: every previously persisted lead was qualified
-- (the orchestrator only inserted qualifying ones), so the default is
-- correct for legacy data.

create index if not exists leads_qualified_idx on leads(qualified);
