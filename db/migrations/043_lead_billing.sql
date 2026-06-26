-- 043_lead_billing.sql — record-only billing on a lead (per-deal amounts).
--
-- The operator records the agreed setup fee + monthly hosting price and the
-- billing status when a deal closes. No live charging yet (Stripe later); this
-- is the source of truth for revenue tracking (active monthly = MRR).
--
-- billing_status: null (not billed) | invoiced | active | past_due | canceled

alter table leads add column if not exists setup_fee numeric;
alter table leads add column if not exists monthly_amount numeric;
alter table leads add column if not exists billing_status text;
alter table leads add column if not exists billing_notes text;
alter table leads add column if not exists billing_updated_at timestamptz;

create index if not exists idx_leads_billing_status on leads (billing_status);
