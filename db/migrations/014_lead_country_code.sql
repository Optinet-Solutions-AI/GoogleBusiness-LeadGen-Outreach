-- 014_lead_country_code.sql — denormalize batches.country_code onto leads.
--
-- The lead list / detail UI need country to disambiguate cities like
-- "Hamilton" (NZ vs CA) and "Mendoza" (AR). Joining batches on every
-- list render works but is noisy; this stores the value once on the
-- lead row so it can be selected and filtered directly.
--
-- The batch is inherently single-country (its country_code biases the
-- scraper's regionCode), so denormalizing is safe: every lead in a
-- batch shares the batch's country.

alter table leads add column if not exists country_code text;

-- Backfill from the parent batch so existing leads aren't blank.
update leads l
   set country_code = b.country_code
  from batches b
 where l.batch_id = b.id
   and l.country_code is null;

create index if not exists leads_country_code_idx on leads(country_code);
