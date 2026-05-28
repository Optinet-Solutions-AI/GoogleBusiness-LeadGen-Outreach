-- 015_lead_variants.sql — persist the per-build variants picked for each lead.
--
-- Stage-3 writes `data.variants` into the template's data.json each build:
--   { hero, services, reviews, trust, service_area, cta }
-- That object never made it into Supabase, so we couldn't see which
-- combination shipped for a given lead — meaning we also couldn't reason
-- about diversity across leads in the same niche.
--
-- Two estate-sales leads in a row got identical variants (editorial-split
-- hero + photo-cards services + masonry-grid reviews + animated-strip
-- trust + styled-list service_area) because both Gemini and the picker
-- fallback default toward the same favorites without seeing what the
-- prior leads in the niche already used.
--
-- With this column, stage-3 can query recent same-niche leads and pass
-- their variants to the picker as an "avoid if possible" constraint.

alter table leads add column if not exists variants jsonb;

-- No backfill — existing rows leave this null, which the picker treats
-- as "no prior variant" rather than "all avoided".
--
-- (niche isn't a column on the leads table — it lives on batches and
-- is also recomputed at runtime via classifyNiche(category). The avoid
-- lookup classifies each candidate row's category in JS instead of
-- relying on a column index, so no niche-conditional index is needed.)
