/**
 * data/niches.ts — curated niche presets for the New Batch modal.
 *
 * Two axes per niche:
 *   - category: WHAT the business does (Trades, Pets, Personal Services…).
 *               Used for grouping in the dropdown so the user can browse.
 *   - yield:    HOW LIKELY a business in this niche skips having a real
 *               website (high / medium / low). Drawn from observed
 *               has_website rejection rates on real batches.
 *
 * Free-form typing is still allowed — these are suggestions, not a whitelist.
 */

export type NicheYield = "high" | "medium" | "low";

export type NicheCategory =
  | "Personal Services"
  | "Events & Hospitality"
  | "Pets"
  | "Auto"
  | "Home & Outdoor"
  | "Trades"
  | "Real Estate & Sales"
  | "Beauty & Wellness"
  | "Food"
  | "Professional";

export interface NicheOption {
  value: string;
  category: NicheCategory;
  yield: NicheYield;
  hint: string;
}

export const NICHE_OPTIONS: NicheOption[] = [
  // ── Personal Services ───────────────────────────────────────────
  { value: "personal trainer",        category: "Personal Services", yield: "high",   hint: "Independents use Linktree at most" },
  { value: "independent tutor",       category: "Personal Services", yield: "high",   hint: "Word-of-mouth driven" },
  { value: "music teacher",           category: "Personal Services", yield: "high",   hint: "Independent piano/guitar teachers" },
  { value: "babysitter",              category: "Personal Services", yield: "high",   hint: "Independent, not agency" },
  { value: "personal chef",           category: "Personal Services", yield: "high",   hint: "In-home, very small operators" },
  { value: "mobile notary",           category: "Personal Services", yield: "high",   hint: "Phone-driven, especially tier-3" },
  { value: "life coach",              category: "Personal Services", yield: "medium", hint: "Often Instagram-only" },

  // ── Events & Hospitality ────────────────────────────────────────
  { value: "bartender for hire",      category: "Events & Hospitality", yield: "high",   hint: "Almost all Instagram-only" },
  { value: "event photographer",      category: "Events & Hospitality", yield: "medium", hint: "Some still IG-only" },
  { value: "wedding officiant",       category: "Events & Hospitality", yield: "medium", hint: "Very local, low digital" },
  { value: "balloon artist",          category: "Events & Hospitality", yield: "high",   hint: "Almost always IG/FB only" },
  { value: "dj for hire",             category: "Events & Hospitality", yield: "medium", hint: "Mixed — some have basic sites" },

  // ── Pets ────────────────────────────────────────────────────────
  { value: "dog walker",              category: "Pets", yield: "high",   hint: "Independent, not Wag/Rover" },
  { value: "pet sitter",              category: "Pets", yield: "high",   hint: "Independent, very local" },
  { value: "mobile dog grooming",     category: "Pets", yield: "medium", hint: "Solo operators, varies by city" },
  { value: "dog trainer",             category: "Pets", yield: "medium", hint: "Independent trainers" },

  // ── Auto ────────────────────────────────────────────────────────
  { value: "mobile car detailing",    category: "Auto", yield: "medium", hint: "Some still Facebook-only" },
  { value: "mobile mechanic",         category: "Auto", yield: "medium", hint: "Better in smaller markets" },
  { value: "auto window tinting",     category: "Auto", yield: "medium", hint: "Mixed digital adoption" },

  // ── Home & Outdoor ──────────────────────────────────────────────
  { value: "junk removal",            category: "Home & Outdoor", yield: "medium", hint: "Mom-and-pop ops in tier-3" },
  { value: "pressure washing",        category: "Home & Outdoor", yield: "medium", hint: "Saturated in TX, better in AL/MS" },
  { value: "lawn care",               category: "Home & Outdoor", yield: "medium", hint: "Saturated near metros" },
  { value: "pool cleaning",           category: "Home & Outdoor", yield: "medium", hint: "Many tiny route operators" },
  { value: "gutter cleaning",         category: "Home & Outdoor", yield: "medium", hint: "Seasonal solo operators" },
  { value: "christmas light installation", category: "Home & Outdoor", yield: "medium", hint: "Seasonal, often phone-only" },
  { value: "snow plowing",            category: "Home & Outdoor", yield: "medium", hint: "Seasonal, cold regions" },
  { value: "house cleaning",          category: "Home & Outdoor", yield: "medium", hint: "Independent cleaners" },

  // ── Trades ──────────────────────────────────────────────────────
  { value: "handyman",                category: "Trades", yield: "medium", hint: "Saturated in major metros" },
  { value: "plumber",                 category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "electrician",             category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "hvac",                    category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "roofer",                  category: "Trades", yield: "low",    hint: "Almost universally websited" },
  { value: "painter",                 category: "Trades", yield: "low",    hint: "Saturated digitally" },
  { value: "landscaping",             category: "Trades", yield: "low",    hint: "Saturated digitally" },

  // ── Real Estate & Sales ─────────────────────────────────────────
  { value: "estate sale company",     category: "Real Estate & Sales", yield: "high",   hint: "Phone + FB driven, very low site adoption" },
  { value: "auctioneer",              category: "Real Estate & Sales", yield: "medium", hint: "Many independents, mixed digital" },

  // ── Food ────────────────────────────────────────────────────────
  { value: "mobile food vendor",      category: "Food", yield: "high",   hint: "Food trucks/carts; ~30-40% no site" },
  { value: "food truck",              category: "Food", yield: "high",   hint: "Often Instagram-only" },
  { value: "caterer",                 category: "Food", yield: "medium", hint: "Independent caterers" },
  { value: "restaurant",              category: "Food", yield: "low",    hint: "Yelp + delivery apps cover them" },

  // ── Beauty & Wellness ───────────────────────────────────────────
  { value: "salon",                   category: "Beauty & Wellness", yield: "low",    hint: "Booksy / Square / Vagaro dominate" },
  { value: "massage therapist",       category: "Beauty & Wellness", yield: "medium", hint: "Independent therapists" },
  { value: "nail technician",         category: "Beauty & Wellness", yield: "medium", hint: "Independent, often IG-only" },

  // ── Professional ────────────────────────────────────────────────
  { value: "lawyer",                  category: "Professional", yield: "low", hint: "Almost universally websited" },
  { value: "accountant",              category: "Professional", yield: "low", hint: "Almost universally websited" },
];

export const NICHE_CATEGORIES: NicheCategory[] = [
  "Personal Services",
  "Events & Hospitality",
  "Pets",
  "Auto",
  "Home & Outdoor",
  "Trades",
  "Real Estate & Sales",
  "Food",
  "Beauty & Wellness",
  "Professional",
];

export const YIELD_LABEL: Record<NicheYield, string> = {
  high: "High yield",
  medium: "Medium",
  low: "Low (skip)",
};

export const YIELD_DOT: Record<NicheYield, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-rose-400",
};
