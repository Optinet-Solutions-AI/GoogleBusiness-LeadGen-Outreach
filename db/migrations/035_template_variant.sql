-- 035_template_variant.sql
-- Operator-selectable site design per niche. Each niche exposes 3 designs
-- (see web/lib/templates/registry.ts). batches.template_variant is the batch
-- default; leads.template_variant overrides it per lead. null = inherit /
-- registry default (first design). Resolved in lib/pipeline/build-lead.ts.

alter table batches add column if not exists template_variant text;
alter table leads   add column if not exists template_variant text;
