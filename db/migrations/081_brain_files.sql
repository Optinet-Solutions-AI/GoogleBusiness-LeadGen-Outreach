-- 081_brain_files.sql — the Brain's message box takes files (27 Nov 2026): a list of businesses to work, or a brief.
--
-- batches.scraper adds 'import': a batch made from a list attached to a Brain job (no scraping; every row gets the
--   usual checks, then the Brain judges and plans).
-- brain_jobs.brief        the attached briefs' text (PDF / Word / text / image), given to the AI as data.
-- brain_jobs.attachments  what each file gave: name, kind, rows used / skipped and why, notes.
-- brain_jobs.import_rows  a list's rows until Start (then they become the batch's leads) or Cancel (cleared).
-- Without these, attaching files is refused with "Run database update 081 first"; typed jobs work as before.
alter table batches drop constraint if exists batches_scraper_check;
alter table batches add constraint batches_scraper_check
    check (scraper in ('apify','outscraper','google_places','warn','sec','exhibitors','trustpilot','tripadvisor','import'));
alter table brain_jobs add column if not exists brief text;
alter table brain_jobs add column if not exists attachments jsonb;
alter table brain_jobs add column if not exists import_rows jsonb;
