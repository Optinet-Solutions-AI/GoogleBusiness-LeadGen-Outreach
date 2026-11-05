/**
 * data/exhibitor-categories.ts — conference categories for exhibitor batches (client-safe, no imports).
 *
 * Inputs:  none
 * Outputs: EXHIBITOR_CATEGORIES (value = batches.niche, label for the form) + EUROPE_ALL
 * Used by: components/NewBatchModal.tsx, lib/services/exhibitors.ts
 */
export const EXHIBITOR_CATEGORIES = [
  { value: "igaming", label: "iGaming & betting" },
  { value: "gaming", label: "Gaming & esports" },
  { value: "technology", label: "Technology & SaaS" },
  { value: "fintech", label: "Fintech & payments" },
  { value: "food", label: "Food & drink" },
  { value: "marketing", label: "Marketing & affiliate" },
  { value: "health", label: "Health & pharma" },
  { value: "real_estate", label: "Real estate & construction" },
  { value: "any", label: "Any industry" },
] as const;

export type ExhibitorCategory = (typeof EXHIBITOR_CATEGORIES)[number]["value"];

/** The "all of Europe" country value for exhibitor batches (batches.city + country_code). */
export const EUROPE_ALL = "eu";
