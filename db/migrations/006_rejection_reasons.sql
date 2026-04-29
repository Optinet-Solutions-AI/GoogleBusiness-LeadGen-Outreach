-- 006_rejection_reasons.sql — track WHY leads were rejected by the qualifier
-- so the batch detail UI can break down "60 scraped, 0 qualified" into the
-- specific reasons (40 had_website, 15 low_rating, etc.).

alter table batches
    add column if not exists rejection_reasons jsonb default '{}'::jsonb;

-- shape: { has_website: 40, low_rating: 15, few_reviews: 0, no_phone: 0, category_mismatch: 5 }
