-- 005_persist_batch_counts.sql — record stage 1's scrape/reject counts on the batch row.
--
-- Before: orchestrator returned `{ scraped, rejected }` from runBatch but the
-- numbers were not persisted. Dashboard could only show count of saved leads,
-- which made it impossible to tell the difference between
--   (a) Google returned 0 results, vs.
--   (b) Google returned 60 but the qualifier filter rejected all of them.
--
-- After: scraped_count + rejected_count live on the batch row. UI uses them
-- to surface "Scraped 60, qualified 0" so the operator immediately sees that
-- the scrape worked but the market has no unwebsited businesses.

alter table batches
    add column if not exists scraped_count   int default 0,
    add column if not exists rejected_count  int default 0;
