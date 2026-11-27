-- 079_live_progress.sql — live progress for running batches and Brain jobs (27 Nov 2026, from the Explee walkthrough).
--
-- progress = { steps: [{key, label, state: waiting|running|done}], current, line, done?, total?, at }: the step list
-- with ticks and one live line ("checking websites and researching contacts… 12 of 42") the batch page and the Brain
-- page show while the job works. Written by the Cloud Run worker at most every 2 seconds (lib/progress.ts).
-- Without these columns nothing is saved and the pages show their older one-line status.
alter table batches add column if not exists progress jsonb;
alter table brain_jobs add column if not exists progress jsonb;
