-- 030_batches_last_error.sql
-- Add the failure-reason column the stale-batch reaper + orchestrator already
-- write to. Today the column is missing, so those updates silently fail and a
-- stuck "running" batch never flips to "failed".
-- House style: idempotent; RLS disabled (prod reads with a key subject to RLS).

alter table if exists batches add column if not exists last_error text;
