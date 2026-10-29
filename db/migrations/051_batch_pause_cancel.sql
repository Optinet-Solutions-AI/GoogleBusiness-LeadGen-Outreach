-- 051_batch_pause_cancel.sql — pause / resume / cancel a scraping batch.
--
-- status gains 'paused' and 'cancelled'. A running batch is stopped by a request the runner reads with its
-- heartbeat (stop_requested), so it can abort the paid Apify run and save what it has. A paused batch whose
-- scrape already finished resumes with enrichment only (resume_from = 'enrich'), never a second scrape.
--
-- Additive + idempotent. Run in the Supabase SQL editor.
do $$
declare c record;
begin
    for c in select conname from pg_constraint
             where conrelid = 'batches'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) ilike '%status%'
               and pg_get_constraintdef(oid) ilike '%queued%'
    loop
        execute format('alter table batches drop constraint if exists %I', c.conname);
    end loop;
end $$;
alter table batches add constraint batches_status_check
    check (status in ('queued','running','done','failed','paused','cancelled'));

alter table batches add column if not exists stop_requested text;
alter table batches add column if not exists resume_from text;
alter table batches drop constraint if exists batches_stop_requested_check;
alter table batches add constraint batches_stop_requested_check
    check (stop_requested is null or stop_requested in ('pause','cancel'));
alter table batches drop constraint if exists batches_resume_from_check;
alter table batches add constraint batches_resume_from_check
    check (resume_from is null or resume_from = 'enrich');
