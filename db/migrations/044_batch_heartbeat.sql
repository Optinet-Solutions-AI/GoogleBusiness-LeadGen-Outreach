-- 044_batch_heartbeat.sql — self-healing for stuck "running" batches.
--
-- Problem: when the process running a scrape dies mid-flight (Cloud Run job
-- crash/timeout, or a Vercel function killed at ~60s), the batch row never
-- gets its final done/failed write and hangs at status='running' forever.
-- Nothing reconciled it, so the dashboard lied and the only recovery was a
-- manual DB edit or a second (paid) scrape.
--
-- Fix: the runner emits a heartbeat while it's alive (see orchestrator.runBatch).
-- A watchdog (lib/pipeline/reap-stuck.ts) marks any 'running' batch whose
-- heartbeat has gone stale as 'failed' — so a dead process self-heals within
-- a few minutes with no operator action and no risk of double-charging a
-- scrape that is genuinely still running.
--
-- `runner` records which path handled the batch ('cloud-run' | 'vercel' | 'cli')
-- purely for diagnostics.

alter table batches add column if not exists heartbeat_at timestamptz;
alter table batches add column if not exists runner       text;

-- Reaper scans running batches ordered by heartbeat staleness.
create index if not exists batches_running_heartbeat_idx
    on batches(heartbeat_at)
    where status = 'running';
