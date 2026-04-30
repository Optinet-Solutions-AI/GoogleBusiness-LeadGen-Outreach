/**
 * data/cities.ts — global cascade for the New Batch modal:
 *   Continent → Country → City.
 *
 * `country_code` (ISO 3166-1 alpha-2) is sent to the backend and used as
 * Google Places' `regionCode` to bias scrape results. Picking a country
 * actually changes WHERE the scrape runs, not just the UI suggestions.
 *
 * Coverage: English-speaking markets where SMB digital adoption is mid-low
 * (best yield) plus the major metros we expect to be saturated. Pick an
 * "lower digital adoption" tag for first runs.
 *
 * Free-form typing on the city input is allowed — these are presets, not
 * a whitelist.
 */

export type Continent =
  | "North America"
  | "Europe"
  | "Oceania"
  | "Asia"
  | "Africa"
  | "South America";

/** ISO 3166-1 alpha-2, lowercase for Places `regionCode`. */
export type CountryCode =
  | "us" | "ca"                                  // North America
  | "gb" | "ie"                                  // Europe
  | "au" | "nz"                                  // Oceania
  | "ph" | "sg" | "my" | "in" | "ae"             // Asia
  | "za"                                          // Africa
  | "br";                                         // South America

export interface CountryOption {
  code: CountryCode;
  label: string;
  continent: Continent;
  /** "good" markets generally have lower SMB digital adoption. */
  marketTier: "good" | "ok" | "saturated";
}

export const COUNTRIES: CountryOption[] = [
  // ── North America ───────────────────────────────────────────────
  { code: "us", label: "United States", continent: "North America", marketTier: "ok" },
  { code: "ca", label: "Canada",        continent: "North America", marketTier: "ok" },

  // ── Europe ──────────────────────────────────────────────────────
  // Note: GDPR limits direct-marketing to EU prospects — see CLAUDE.md.
  // Use these for testing the pipeline only until compliance is reviewed.
  { code: "gb", label: "United Kingdom", continent: "Europe", marketTier: "saturated" },
  { code: "ie", label: "Ireland",        continent: "Europe", marketTier: "ok" },

  // ── Oceania ─────────────────────────────────────────────────────
  { code: "au", label: "Australia",   continent: "Oceania", marketTier: "ok" },
  { code: "nz", label: "New Zealand", continent: "Oceania", marketTier: "good" },

  // ── Asia ────────────────────────────────────────────────────────
  { code: "ph", label: "Philippines",  continent: "Asia", marketTier: "good" },
  { code: "sg", label: "Singapore",    continent: "Asia", marketTier: "saturated" },
  { code: "my", label: "Malaysia",     continent: "Asia", marketTier: "good" },
  { code: "in", label: "India",        continent: "Asia", marketTier: "good" },
  { code: "ae", label: "United Arab Emirates", continent: "Asia", marketTier: "ok" },

  // ── Africa ──────────────────────────────────────────────────────
  { code: "za", label: "South Africa", continent: "Africa", marketTier: "good" },

  // ── South America ───────────────────────────────────────────────
  { code: "br", label: "Brazil",       continent: "South America", marketTier: "good" },
];

export interface CityOption {
  /** Human-readable string sent as the Places query suffix. */
  value: string;
  population_k: number;
  region: string;
  country: CountryCode;
  quality: "good" | "ok" | "saturated";
}

export const CITY_OPTIONS: CityOption[] = [
  // ── United States ────────────────────────────────────────────────
  // South / Mid-South — best yield (lower digital saturation)
  { value: "Mobile, AL",       population_k: 187, region: "AL", country: "us", quality: "good" },
  { value: "Birmingham, AL",   population_k: 197, region: "AL", country: "us", quality: "good" },
  { value: "Tuscaloosa, AL",   population_k: 101, region: "AL", country: "us", quality: "good" },
  { value: "Montgomery, AL",   population_k: 196, region: "AL", country: "us", quality: "good" },
  { value: "Huntsville, AL",   population_k: 215, region: "AL", country: "us", quality: "good" },
  { value: "Jackson, MS",      population_k: 145, region: "MS", country: "us", quality: "good" },
  { value: "Hattiesburg, MS",  population_k:  46, region: "MS", country: "us", quality: "good" },
  { value: "Shreveport, LA",   population_k: 180, region: "LA", country: "us", quality: "good" },
  { value: "Baton Rouge, LA",  population_k: 220, region: "LA", country: "us", quality: "good" },
  { value: "Lafayette, LA",    population_k: 121, region: "LA", country: "us", quality: "good" },
  { value: "Memphis, TN",      population_k: 628, region: "TN", country: "us", quality: "good" },
  { value: "Knoxville, TN",    population_k: 191, region: "TN", country: "us", quality: "good" },
  { value: "Chattanooga, TN",  population_k: 181, region: "TN", country: "us", quality: "good" },
  { value: "Macon, GA",        population_k: 155, region: "GA", country: "us", quality: "good" },
  { value: "Columbus, GA",     population_k: 207, region: "GA", country: "us", quality: "good" },
  { value: "Tallahassee, FL",  population_k: 197, region: "FL", country: "us", quality: "good" },
  { value: "Fort Smith, AR",   population_k:  88, region: "AR", country: "us", quality: "good" },
  { value: "Little Rock, AR",  population_k: 203, region: "AR", country: "us", quality: "good" },
  // Plains / Mid — okay yield
  { value: "Wichita, KS",      population_k: 397, region: "KS", country: "us", quality: "ok" },
  { value: "Springfield, MO",  population_k: 169, region: "MO", country: "us", quality: "ok" },
  { value: "Sioux Falls, SD",  population_k: 196, region: "SD", country: "us", quality: "ok" },
  { value: "Tulsa, OK",        population_k: 411, region: "OK", country: "us", quality: "ok" },
  { value: "Boise, ID",        population_k: 235, region: "ID", country: "us", quality: "ok" },
  // Big metros — saturated
  { value: "Austin, TX",       population_k: 974, region: "TX", country: "us", quality: "saturated" },
  { value: "Houston, TX",      population_k: 2300, region: "TX", country: "us", quality: "saturated" },
  { value: "Dallas, TX",       population_k: 1304, region: "TX", country: "us", quality: "saturated" },

  // ── Canada ──────────────────────────────────────────────────────
  { value: "Saskatoon, SK",    population_k: 273, region: "SK", country: "ca", quality: "good" },
  { value: "Halifax, NS",      population_k: 439, region: "NS", country: "ca", quality: "good" },
  { value: "Hamilton, ON",     population_k: 569, region: "ON", country: "ca", quality: "ok" },
  { value: "Winnipeg, MB",     population_k: 749, region: "MB", country: "ca", quality: "ok" },
  { value: "Calgary, AB",      population_k: 1306, region: "AB", country: "ca", quality: "saturated" },
  { value: "Toronto, ON",      population_k: 2794, region: "ON", country: "ca", quality: "saturated" },

  // ── United Kingdom ──────────────────────────────────────────────
  { value: "Plymouth",         population_k: 264, region: "England", country: "gb", quality: "ok" },
  { value: "Norwich",          population_k: 144, region: "England", country: "gb", quality: "ok" },
  { value: "Stoke-on-Trent",   population_k: 256, region: "England", country: "gb", quality: "ok" },
  { value: "Hull",             population_k: 267, region: "England", country: "gb", quality: "ok" },
  { value: "Manchester",       population_k: 553, region: "England", country: "gb", quality: "saturated" },
  { value: "London",           population_k: 8982, region: "England", country: "gb", quality: "saturated" },

  // ── Ireland ─────────────────────────────────────────────────────
  { value: "Cork",             population_k: 224, region: "Cork", country: "ie", quality: "good" },
  { value: "Limerick",         population_k:  94, region: "Limerick", country: "ie", quality: "good" },
  { value: "Galway",           population_k:  85, region: "Galway", country: "ie", quality: "good" },
  { value: "Dublin",           population_k: 592, region: "Leinster", country: "ie", quality: "saturated" },

  // ── Australia ───────────────────────────────────────────────────
  { value: "Adelaide, SA",     population_k: 1402, region: "SA", country: "au", quality: "good" },
  { value: "Hobart, TAS",      population_k: 252,  region: "TAS", country: "au", quality: "good" },
  { value: "Newcastle, NSW",   population_k: 322,  region: "NSW", country: "au", quality: "ok" },
  { value: "Geelong, VIC",     population_k: 271,  region: "VIC", country: "au", quality: "ok" },
  { value: "Perth, WA",        population_k: 2192, region: "WA", country: "au", quality: "ok" },
  { value: "Brisbane, QLD",    population_k: 2568, region: "QLD", country: "au", quality: "saturated" },
  { value: "Melbourne, VIC",   population_k: 5078, region: "VIC", country: "au", quality: "saturated" },
  { value: "Sydney, NSW",      population_k: 5312, region: "NSW", country: "au", quality: "saturated" },

  // ── New Zealand ─────────────────────────────────────────────────
  { value: "Hamilton",         population_k: 178, region: "Waikato", country: "nz", quality: "good" },
  { value: "Tauranga",         population_k: 158, region: "Bay of Plenty", country: "nz", quality: "good" },
  { value: "Dunedin",          population_k: 134, region: "Otago", country: "nz", quality: "good" },
  { value: "Christchurch",     population_k: 396, region: "Canterbury", country: "nz", quality: "ok" },
  { value: "Auckland",         population_k: 1463, region: "Auckland", country: "nz", quality: "saturated" },

  // ── Philippines ─────────────────────────────────────────────────
  { value: "Cebu City",        population_k: 964,  region: "Cebu",      country: "ph", quality: "good" },
  { value: "Davao City",       population_k: 1776, region: "Davao",     country: "ph", quality: "good" },
  { value: "Iloilo City",      population_k: 457,  region: "Iloilo",    country: "ph", quality: "good" },
  { value: "Bacolod",          population_k: 600,  region: "Negros Occ.", country: "ph", quality: "good" },
  { value: "Cagayan de Oro",   population_k: 728,  region: "Misamis Or.", country: "ph", quality: "good" },
  { value: "Quezon City",      population_k: 2960, region: "NCR",       country: "ph", quality: "ok" },
  { value: "Manila",           population_k: 1846, region: "NCR",       country: "ph", quality: "saturated" },

  // ── Singapore ───────────────────────────────────────────────────
  { value: "Singapore",        population_k: 5454, region: "Singapore", country: "sg", quality: "saturated" },

  // ── Malaysia ────────────────────────────────────────────────────
  { value: "Penang",           population_k: 794,  region: "Penang",    country: "my", quality: "good" },
  { value: "Johor Bahru",      population_k: 497,  region: "Johor",     country: "my", quality: "good" },
  { value: "Ipoh",             population_k: 759,  region: "Perak",     country: "my", quality: "good" },
  { value: "Kuala Lumpur",     population_k: 1808, region: "WP",        country: "my", quality: "ok" },

  // ── India ───────────────────────────────────────────────────────
  { value: "Indore",           population_k: 1964, region: "MP", country: "in", quality: "good" },
  { value: "Bhopal",           population_k: 1798, region: "MP", country: "in", quality: "good" },
  { value: "Lucknow",          population_k: 2817, region: "UP", country: "in", quality: "good" },
  { value: "Jaipur",           population_k: 3046, region: "RJ", country: "in", quality: "ok" },
  { value: "Ahmedabad",        population_k: 5570, region: "GJ", country: "in", quality: "ok" },

  // ── UAE ─────────────────────────────────────────────────────────
  { value: "Sharjah",          population_k: 1700, region: "Sharjah", country: "ae", quality: "ok" },
  { value: "Abu Dhabi",        population_k: 1483, region: "Abu Dhabi", country: "ae", quality: "saturated" },
  { value: "Dubai",            population_k: 3604, region: "Dubai", country: "ae", quality: "saturated" },

  // ── South Africa ────────────────────────────────────────────────
  { value: "Port Elizabeth",   population_k: 1263, region: "EC", country: "za", quality: "good" },
  { value: "East London",      population_k:  478, region: "EC", country: "za", quality: "good" },
  { value: "Bloemfontein",     population_k:  556, region: "FS", country: "za", quality: "good" },
  { value: "Pretoria",         population_k: 2473, region: "GP", country: "za", quality: "ok" },
  { value: "Durban",           population_k: 3442, region: "KZN", country: "za", quality: "ok" },
  { value: "Cape Town",        population_k: 4618, region: "WC", country: "za", quality: "saturated" },

  // ── Brazil ──────────────────────────────────────────────────────
  { value: "Recife",           population_k: 1488, region: "PE", country: "br", quality: "good" },
  { value: "Salvador",         population_k: 2418, region: "BA", country: "br", quality: "ok" },
  { value: "Belo Horizonte",   population_k: 2316, region: "MG", country: "br", quality: "ok" },
];

export const QUALITY_LABEL: Record<CityOption["quality"], string> = {
  good: "Good market",
  ok: "OK market",
  saturated: "Saturated — likely 0 leads",
};

export const QUALITY_DOT: Record<CityOption["quality"], string> = {
  good: "bg-emerald-500",
  ok: "bg-amber-500",
  saturated: "bg-rose-400",
};

/** Continents that have at least one country in COUNTRIES. */
export const CONTINENTS: Continent[] = Array.from(
  new Set(COUNTRIES.map((c) => c.continent)),
);

/** Pre-baked combos that consistently return qualified leads. */
export const RECOMMENDED_COMBOS: { niche: string; city: string; country: CountryCode }[] = [
  { niche: "estate sale company", city: "Mobile, AL",      country: "us" },
  { niche: "bartender for hire",  city: "Memphis, TN",     country: "us" },
  { niche: "personal trainer",    city: "Jackson, MS",     country: "us" },
  { niche: "mobile food vendor",  city: "Birmingham, AL",  country: "us" },
  { niche: "junk removal",        city: "Tuscaloosa, AL",  country: "us" },
  { niche: "independent tutor",   city: "Knoxville, TN",   country: "us" },
  { niche: "mobile notary",       city: "Shreveport, LA",  country: "us" },
  { niche: "mobile dog grooming", city: "Adelaide, SA",    country: "au" },
  { niche: "personal trainer",    city: "Cebu City",       country: "ph" },
  { niche: "balloon artist",      city: "Hamilton",        country: "nz" },
];
