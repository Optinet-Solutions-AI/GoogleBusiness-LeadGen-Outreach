-- 048_plan_confirmed_estimate.sql — the operator-confirmed cost figure on a month plan (Creative Studio).
--
-- Problem: the Generate route validated the figure the operator confirmed and then dropped it, so the job's
-- budget stop used content_plans.estimate_usd (the step-1 whole-month upper bound) instead.
--
-- Fix: POST /api/clients/:id/plans/:pid/generate stores the confirmed figure here before dispatching the job;
-- the job stops at min(confirmed_estimate_usd x 1.25, CREATIVE_PLAN_BUDGET_USD - AI spend already recorded
-- for this plan in generation_jobs). content_plans has no free jsonb column for it (concepts is the concept
-- array), hence a dedicated column.
--
-- Additive + idempotent. Apply with:
--   psql "$SUPABASE_URL" -f db/migrations/048_plan_confirmed_estimate.sql   (run by the operator)

alter table content_plans add column if not exists confirmed_estimate_usd numeric;
