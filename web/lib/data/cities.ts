/**
 * data/cities.ts — global cascade for the New Batch modal:
 *   Continent → Country → City.
 *
 * `country_code` (ISO 3166-1 alpha-2, lowercase) is sent to the backend
 * and used as Google Places' `regionCode` to bias scrape results.
 *
 * Coverage philosophy: prioritise English-friendly business markets and
 * places where SMBs have low digital adoption (= more "no website" leads).
 * Some EU countries are listed for completeness but reminder per CLAUDE.md:
 * GDPR forbids cold-email outreach to EU prospects without compliance review.
 *
 * Free-form typing on the city input is allowed elsewhere — these are
 * presets, not a whitelist.
 */

export type Continent =
  | "North America"
  | "South America"
  | "Europe"
  | "Oceania"
  | "Asia"
  | "Africa"
  | "Middle East"
  | "Caribbean";

export interface CountryOption {
  code: string;
  label: string;
  continent: Continent;
  /** "good" markets generally have lower SMB digital adoption. */
  marketTier: "good" | "ok" | "saturated";
  /** Optional flag — currently used for GDPR. */
  gdpr?: true;
}

export const COUNTRIES = [
  // ── North America ───────────────────────────────────────────────
  { code: "us", label: "United States", continent: "North America", marketTier: "ok" },
  { code: "ca", label: "Canada",        continent: "North America", marketTier: "ok" },
  { code: "mx", label: "Mexico",        continent: "North America", marketTier: "good" },

  // ── South America ───────────────────────────────────────────────
  { code: "br", label: "Brazil",        continent: "South America", marketTier: "good" },
  { code: "ar", label: "Argentina",     continent: "South America", marketTier: "good" },
  { code: "cl", label: "Chile",         continent: "South America", marketTier: "ok" },
  { code: "co", label: "Colombia",      continent: "South America", marketTier: "good" },
  { code: "pe", label: "Peru",          continent: "South America", marketTier: "good" },

  // ── Europe (GDPR — for testing the pipeline only) ──────────────
  { code: "gb", label: "United Kingdom", continent: "Europe", marketTier: "saturated", gdpr: true },
  { code: "ie", label: "Ireland",        continent: "Europe", marketTier: "ok",        gdpr: true },
  { code: "de", label: "Germany",        continent: "Europe", marketTier: "saturated", gdpr: true },
  { code: "fr", label: "France",         continent: "Europe", marketTier: "saturated", gdpr: true },
  { code: "es", label: "Spain",          continent: "Europe", marketTier: "ok",        gdpr: true },
  { code: "it", label: "Italy",          continent: "Europe", marketTier: "ok",        gdpr: true },
  { code: "pt", label: "Portugal",       continent: "Europe", marketTier: "ok",        gdpr: true },
  { code: "nl", label: "Netherlands",    continent: "Europe", marketTier: "saturated", gdpr: true },
  { code: "se", label: "Sweden",         continent: "Europe", marketTier: "saturated", gdpr: true },
  { code: "no", label: "Norway",         continent: "Europe", marketTier: "saturated", gdpr: true },
  { code: "pl", label: "Poland",         continent: "Europe", marketTier: "ok",        gdpr: true },
  { code: "gr", label: "Greece",         continent: "Europe", marketTier: "good",      gdpr: true },

  // ── Oceania ─────────────────────────────────────────────────────
  { code: "au", label: "Australia",   continent: "Oceania", marketTier: "ok" },
  { code: "nz", label: "New Zealand", continent: "Oceania", marketTier: "good" },
  { code: "fj", label: "Fiji",        continent: "Oceania", marketTier: "good" },

  // ── Asia ────────────────────────────────────────────────────────
  { code: "ph", label: "Philippines",  continent: "Asia", marketTier: "good" },
  { code: "id", label: "Indonesia",    continent: "Asia", marketTier: "good" },
  { code: "th", label: "Thailand",     continent: "Asia", marketTier: "good" },
  { code: "vn", label: "Vietnam",      continent: "Asia", marketTier: "good" },
  { code: "my", label: "Malaysia",     continent: "Asia", marketTier: "good" },
  { code: "sg", label: "Singapore",    continent: "Asia", marketTier: "saturated" },
  { code: "in", label: "India",        continent: "Asia", marketTier: "good" },
  { code: "jp", label: "Japan",        continent: "Asia", marketTier: "saturated" },
  { code: "kr", label: "South Korea",  continent: "Asia", marketTier: "saturated" },
  { code: "tw", label: "Taiwan",       continent: "Asia", marketTier: "ok" },
  { code: "hk", label: "Hong Kong",    continent: "Asia", marketTier: "saturated" },

  // ── Middle East ─────────────────────────────────────────────────
  { code: "ae", label: "United Arab Emirates", continent: "Middle East", marketTier: "ok" },
  { code: "sa", label: "Saudi Arabia",         continent: "Middle East", marketTier: "ok" },
  { code: "il", label: "Israel",               continent: "Middle East", marketTier: "saturated" },
  { code: "jo", label: "Jordan",               continent: "Middle East", marketTier: "good" },

  // ── Africa ──────────────────────────────────────────────────────
  { code: "za", label: "South Africa", continent: "Africa", marketTier: "good" },
  { code: "ng", label: "Nigeria",      continent: "Africa", marketTier: "good" },
  { code: "ke", label: "Kenya",        continent: "Africa", marketTier: "good" },
  { code: "eg", label: "Egypt",        continent: "Africa", marketTier: "good" },
  { code: "ma", label: "Morocco",      continent: "Africa", marketTier: "good" },
  { code: "gh", label: "Ghana",        continent: "Africa", marketTier: "good" },

  // ── Caribbean ───────────────────────────────────────────────────
  { code: "jm", label: "Jamaica",            continent: "Caribbean", marketTier: "good" },
  { code: "tt", label: "Trinidad & Tobago",  continent: "Caribbean", marketTier: "good" },
  { code: "do", label: "Dominican Republic", continent: "Caribbean", marketTier: "good" },
] as const satisfies readonly CountryOption[];

/** Auto-derived from COUNTRIES — adding a country in the array adds to this type. */
export type CountryCode = (typeof COUNTRIES)[number]["code"];

export interface CityOption {
  /** Human-readable string sent as the Places query suffix. */
  value: string;
  population_k: number;
  region: string;
  country: CountryCode;
  quality: "good" | "ok" | "saturated";
}

export const CITY_OPTIONS: CityOption[] = [
  // ──────────────────────── United States ────────────────────────
  // South / Mid-South — best yield (lower digital saturation)
  { value: "Mobile, AL",       population_k: 187, region: "AL", country: "us", quality: "good" },
  { value: "Birmingham, AL",   population_k: 197, region: "AL", country: "us", quality: "good" },
  { value: "Tuscaloosa, AL",   population_k: 101, region: "AL", country: "us", quality: "good" },
  { value: "Montgomery, AL",   population_k: 196, region: "AL", country: "us", quality: "good" },
  { value: "Huntsville, AL",   population_k: 215, region: "AL", country: "us", quality: "good" },
  { value: "Jackson, MS",      population_k: 145, region: "MS", country: "us", quality: "good" },
  { value: "Hattiesburg, MS",  population_k:  46, region: "MS", country: "us", quality: "good" },
  { value: "Gulfport, MS",     population_k:  72, region: "MS", country: "us", quality: "good" },
  { value: "Shreveport, LA",   population_k: 180, region: "LA", country: "us", quality: "good" },
  { value: "Baton Rouge, LA",  population_k: 220, region: "LA", country: "us", quality: "good" },
  { value: "Lafayette, LA",    population_k: 121, region: "LA", country: "us", quality: "good" },
  { value: "Lake Charles, LA", population_k:  82, region: "LA", country: "us", quality: "good" },
  { value: "Memphis, TN",      population_k: 628, region: "TN", country: "us", quality: "good" },
  { value: "Knoxville, TN",    population_k: 191, region: "TN", country: "us", quality: "good" },
  { value: "Chattanooga, TN",  population_k: 181, region: "TN", country: "us", quality: "good" },
  { value: "Clarksville, TN",  population_k: 166, region: "TN", country: "us", quality: "good" },
  { value: "Macon, GA",        population_k: 155, region: "GA", country: "us", quality: "good" },
  { value: "Columbus, GA",     population_k: 207, region: "GA", country: "us", quality: "good" },
  { value: "Augusta, GA",      population_k: 202, region: "GA", country: "us", quality: "good" },
  { value: "Savannah, GA",     population_k: 145, region: "GA", country: "us", quality: "good" },
  { value: "Tallahassee, FL",  population_k: 197, region: "FL", country: "us", quality: "good" },
  { value: "Pensacola, FL",    population_k:  54, region: "FL", country: "us", quality: "good" },
  { value: "Lakeland, FL",     population_k: 113, region: "FL", country: "us", quality: "good" },
  { value: "Ocala, FL",        population_k:  64, region: "FL", country: "us", quality: "good" },
  { value: "Fort Smith, AR",   population_k:  88, region: "AR", country: "us", quality: "good" },
  { value: "Little Rock, AR",  population_k: 203, region: "AR", country: "us", quality: "good" },
  { value: "Fayetteville, AR", population_k:  93, region: "AR", country: "us", quality: "good" },
  // Plains / Mid — okay yield
  { value: "Wichita, KS",      population_k: 397, region: "KS", country: "us", quality: "ok" },
  { value: "Topeka, KS",       population_k: 126, region: "KS", country: "us", quality: "ok" },
  { value: "Springfield, MO",  population_k: 169, region: "MO", country: "us", quality: "ok" },
  { value: "Joplin, MO",       population_k:  52, region: "MO", country: "us", quality: "ok" },
  { value: "Kansas City, MO",  population_k: 508, region: "MO", country: "us", quality: "ok" },
  { value: "Sioux Falls, SD",  population_k: 196, region: "SD", country: "us", quality: "ok" },
  { value: "Fargo, ND",        population_k: 126, region: "ND", country: "us", quality: "ok" },
  { value: "Cheyenne, WY",     population_k:  65, region: "WY", country: "us", quality: "ok" },
  { value: "Tulsa, OK",        population_k: 411, region: "OK", country: "us", quality: "ok" },
  { value: "Lawton, OK",       population_k:  91, region: "OK", country: "us", quality: "ok" },
  { value: "Oklahoma City, OK", population_k: 695, region: "OK", country: "us", quality: "ok" },
  { value: "Lubbock, TX",      population_k: 263, region: "TX", country: "us", quality: "ok" },
  { value: "Amarillo, TX",     population_k: 200, region: "TX", country: "us", quality: "ok" },
  { value: "El Paso, TX",      population_k: 678, region: "TX", country: "us", quality: "ok" },
  { value: "Boise, ID",        population_k: 235, region: "ID", country: "us", quality: "ok" },
  { value: "Spokane, WA",      population_k: 230, region: "WA", country: "us", quality: "ok" },
  { value: "Albuquerque, NM",  population_k: 564, region: "NM", country: "us", quality: "ok" },
  { value: "Tucson, AZ",       population_k: 542, region: "AZ", country: "us", quality: "ok" },
  // Big metros — saturated
  { value: "Austin, TX",       population_k: 974, region: "TX", country: "us", quality: "saturated" },
  { value: "Houston, TX",      population_k: 2300, region: "TX", country: "us", quality: "saturated" },
  { value: "Dallas, TX",       population_k: 1304, region: "TX", country: "us", quality: "saturated" },
  { value: "San Antonio, TX",  population_k: 1453, region: "TX", country: "us", quality: "saturated" },
  { value: "Phoenix, AZ",      population_k: 1608, region: "AZ", country: "us", quality: "saturated" },
  { value: "Denver, CO",       population_k: 716, region: "CO", country: "us", quality: "saturated" },
  { value: "Atlanta, GA",      population_k: 499, region: "GA", country: "us", quality: "saturated" },
  { value: "Miami, FL",        population_k: 442, region: "FL", country: "us", quality: "saturated" },
  { value: "Los Angeles, CA",  population_k: 3899, region: "CA", country: "us", quality: "saturated" },
  { value: "New York, NY",     population_k: 8336, region: "NY", country: "us", quality: "saturated" },
  { value: "Chicago, IL",      population_k: 2696, region: "IL", country: "us", quality: "saturated" },

  // ──────────────────────── Canada ───────────────────────────────
  { value: "Saskatoon, SK",    population_k: 273, region: "SK", country: "ca", quality: "good" },
  { value: "Regina, SK",       population_k: 230, region: "SK", country: "ca", quality: "good" },
  { value: "Halifax, NS",      population_k: 439, region: "NS", country: "ca", quality: "good" },
  { value: "St. John's, NL",   population_k: 110, region: "NL", country: "ca", quality: "good" },
  { value: "Charlottetown, PE", population_k:  37, region: "PE", country: "ca", quality: "good" },
  { value: "Hamilton, ON",     population_k: 569, region: "ON", country: "ca", quality: "ok" },
  { value: "Winnipeg, MB",     population_k: 749, region: "MB", country: "ca", quality: "ok" },
  { value: "Quebec City, QC",  population_k: 549, region: "QC", country: "ca", quality: "ok" },
  { value: "Ottawa, ON",       population_k: 1017, region: "ON", country: "ca", quality: "ok" },
  { value: "Edmonton, AB",     population_k: 1010, region: "AB", country: "ca", quality: "ok" },
  { value: "Calgary, AB",      population_k: 1306, region: "AB", country: "ca", quality: "saturated" },
  { value: "Toronto, ON",      population_k: 2794, region: "ON", country: "ca", quality: "saturated" },
  { value: "Vancouver, BC",    population_k: 675, region: "BC", country: "ca", quality: "saturated" },
  { value: "Montreal, QC",     population_k: 1762, region: "QC", country: "ca", quality: "saturated" },

  // ──────────────────────── Mexico ───────────────────────────────
  { value: "Mérida, Yucatán",          population_k:  892, region: "YUC", country: "mx", quality: "good" },
  { value: "Querétaro",                population_k:  878, region: "QRO", country: "mx", quality: "good" },
  { value: "Aguascalientes",           population_k:  877, region: "AGU", country: "mx", quality: "good" },
  { value: "San Luis Potosí",          population_k:  824, region: "SLP", country: "mx", quality: "good" },
  { value: "León, Guanajuato",         population_k: 1579, region: "GTO", country: "mx", quality: "good" },
  { value: "Puebla",                   population_k: 1542, region: "PUE", country: "mx", quality: "ok" },
  { value: "Guadalajara",              population_k: 1495, region: "JAL", country: "mx", quality: "ok" },
  { value: "Monterrey",                population_k: 1109, region: "NLE", country: "mx", quality: "ok" },
  { value: "Mexico City",              population_k: 9209, region: "CMX", country: "mx", quality: "saturated" },

  // ──────────────────────── United Kingdom ───────────────────────
  { value: "Plymouth",         population_k: 264, region: "England", country: "gb", quality: "ok" },
  { value: "Norwich",          population_k: 144, region: "England", country: "gb", quality: "ok" },
  { value: "Stoke-on-Trent",   population_k: 256, region: "England", country: "gb", quality: "ok" },
  { value: "Hull",             population_k: 267, region: "England", country: "gb", quality: "ok" },
  { value: "Sunderland",       population_k: 174, region: "England", country: "gb", quality: "ok" },
  { value: "Swansea",          population_k: 246, region: "Wales",   country: "gb", quality: "ok" },
  { value: "Cardiff",          population_k: 372, region: "Wales",   country: "gb", quality: "ok" },
  { value: "Belfast",          population_k: 345, region: "NI",      country: "gb", quality: "ok" },
  { value: "Glasgow",          population_k: 635, region: "Scotland", country: "gb", quality: "ok" },
  { value: "Edinburgh",        population_k: 526, region: "Scotland", country: "gb", quality: "saturated" },
  { value: "Birmingham",       population_k: 1149, region: "England", country: "gb", quality: "saturated" },
  { value: "Leeds",            population_k: 793, region: "England", country: "gb", quality: "saturated" },
  { value: "Liverpool",        population_k: 496, region: "England", country: "gb", quality: "saturated" },
  { value: "Manchester",       population_k: 553, region: "England", country: "gb", quality: "saturated" },
  { value: "London",           population_k: 8982, region: "England", country: "gb", quality: "saturated" },

  // ──────────────────────── Ireland ───────────────────────────────
  { value: "Cork",             population_k: 224, region: "Cork", country: "ie", quality: "good" },
  { value: "Limerick",         population_k:  94, region: "Limerick", country: "ie", quality: "good" },
  { value: "Galway",           population_k:  85, region: "Galway", country: "ie", quality: "good" },
  { value: "Waterford",        population_k:  53, region: "Waterford", country: "ie", quality: "good" },
  { value: "Dublin",           population_k: 592, region: "Leinster", country: "ie", quality: "saturated" },

  // ──────────────────────── Germany ───────────────────────────────
  { value: "Leipzig",          population_k:  601, region: "Saxony",   country: "de", quality: "ok" },
  { value: "Dresden",          population_k:  556, region: "Saxony",   country: "de", quality: "ok" },
  { value: "Nuremberg",        population_k:  515, region: "Bavaria",  country: "de", quality: "ok" },
  { value: "Bremen",           population_k:  566, region: "Bremen",   country: "de", quality: "ok" },
  { value: "Hannover",         population_k:  535, region: "L. Saxony", country: "de", quality: "ok" },
  { value: "Cologne",          population_k: 1085, region: "NRW",      country: "de", quality: "saturated" },
  { value: "Hamburg",          population_k: 1841, region: "Hamburg",  country: "de", quality: "saturated" },
  { value: "Munich",           population_k: 1488, region: "Bavaria",  country: "de", quality: "saturated" },
  { value: "Berlin",           population_k: 3677, region: "Berlin",   country: "de", quality: "saturated" },

  // ──────────────────────── France ────────────────────────────────
  { value: "Saint-Étienne",    population_k:  173, region: "AURA",  country: "fr", quality: "ok" },
  { value: "Reims",            population_k:  182, region: "Grand Est", country: "fr", quality: "ok" },
  { value: "Le Havre",         population_k:  167, region: "Normandy", country: "fr", quality: "ok" },
  { value: "Toulon",           population_k:  176, region: "PACA",  country: "fr", quality: "ok" },
  { value: "Bordeaux",         population_k:  259, region: "N-Aquitaine", country: "fr", quality: "ok" },
  { value: "Toulouse",         population_k:  493, region: "Occitanie", country: "fr", quality: "saturated" },
  { value: "Marseille",        population_k:  870, region: "PACA",  country: "fr", quality: "saturated" },
  { value: "Lyon",             population_k:  522, region: "AURA",  country: "fr", quality: "saturated" },
  { value: "Paris",            population_k: 2148, region: "IDF",   country: "fr", quality: "saturated" },

  // ──────────────────────── Spain ─────────────────────────────────
  { value: "Murcia",           population_k: 460, region: "Murcia",   country: "es", quality: "good" },
  { value: "Vigo",             population_k: 296, region: "Galicia",  country: "es", quality: "good" },
  { value: "Granada",          population_k: 232, region: "Andalusia", country: "es", quality: "good" },
  { value: "Bilbao",           population_k: 346, region: "Basque",   country: "es", quality: "ok" },
  { value: "Málaga",           population_k: 578, region: "Andalusia", country: "es", quality: "ok" },
  { value: "Valencia",         population_k: 791, region: "Valencia", country: "es", quality: "ok" },
  { value: "Seville",          population_k: 688, region: "Andalusia", country: "es", quality: "ok" },
  { value: "Barcelona",        population_k: 1620, region: "Catalonia", country: "es", quality: "saturated" },
  { value: "Madrid",           population_k: 3223, region: "Madrid",   country: "es", quality: "saturated" },

  // ──────────────────────── Italy ─────────────────────────────────
  { value: "Bari",             population_k: 320, region: "Apulia",  country: "it", quality: "good" },
  { value: "Catania",          population_k: 311, region: "Sicily",  country: "it", quality: "good" },
  { value: "Palermo",          population_k: 651, region: "Sicily",  country: "it", quality: "ok" },
  { value: "Bologna",          population_k: 388, region: "E-Romagna", country: "it", quality: "ok" },
  { value: "Genoa",            population_k: 580, region: "Liguria", country: "it", quality: "ok" },
  { value: "Florence",         population_k: 367, region: "Tuscany", country: "it", quality: "saturated" },
  { value: "Naples",           population_k: 921, region: "Campania", country: "it", quality: "saturated" },
  { value: "Turin",            population_k: 870, region: "Piedmont", country: "it", quality: "saturated" },
  { value: "Milan",            population_k: 1396, region: "Lombardy", country: "it", quality: "saturated" },
  { value: "Rome",             population_k: 2873, region: "Lazio",  country: "it", quality: "saturated" },

  // ──────────────────────── Portugal ──────────────────────────────
  { value: "Coimbra",          population_k: 105, region: "Centro", country: "pt", quality: "good" },
  { value: "Braga",            population_k: 192, region: "Norte",  country: "pt", quality: "good" },
  { value: "Porto",            population_k: 237, region: "Norte",  country: "pt", quality: "ok" },
  { value: "Lisbon",           population_k: 545, region: "Lisboa", country: "pt", quality: "saturated" },

  // ──────────────────────── Netherlands ───────────────────────────
  { value: "Eindhoven",        population_k: 235, region: "N-Brabant", country: "nl", quality: "ok" },
  { value: "Tilburg",          population_k: 224, region: "N-Brabant", country: "nl", quality: "ok" },
  { value: "Groningen",        population_k: 234, region: "Groningen", country: "nl", quality: "ok" },
  { value: "Rotterdam",        population_k: 651, region: "Z-Holland", country: "nl", quality: "saturated" },
  { value: "Amsterdam",        population_k: 873, region: "N-Holland", country: "nl", quality: "saturated" },

  // ──────────────────────── Sweden / Norway ───────────────────────
  { value: "Malmö",            population_k: 351, region: "Scania", country: "se", quality: "ok" },
  { value: "Gothenburg",       population_k: 583, region: "V. Götaland", country: "se", quality: "ok" },
  { value: "Stockholm",        population_k: 985, region: "Stockholm", country: "se", quality: "saturated" },
  { value: "Bergen",           population_k: 286, region: "Vestland", country: "no", quality: "ok" },
  { value: "Trondheim",        population_k: 209, region: "Trøndelag", country: "no", quality: "ok" },
  { value: "Oslo",             population_k: 697, region: "Oslo",   country: "no", quality: "saturated" },

  // ──────────────────────── Poland ────────────────────────────────
  { value: "Lublin",           population_k: 339, region: "Lubelskie", country: "pl", quality: "good" },
  { value: "Bydgoszcz",        population_k: 348, region: "Kujawy",   country: "pl", quality: "good" },
  { value: "Wrocław",          population_k: 643, region: "L-Silesia", country: "pl", quality: "ok" },
  { value: "Poznań",           population_k: 533, region: "G-Poland", country: "pl", quality: "ok" },
  { value: "Kraków",           population_k: 779, region: "L-Poland", country: "pl", quality: "ok" },
  { value: "Warsaw",           population_k: 1794, region: "Mazowieckie", country: "pl", quality: "saturated" },

  // ──────────────────────── Greece ────────────────────────────────
  { value: "Patras",           population_k: 214, region: "W-Greece", country: "gr", quality: "good" },
  { value: "Heraklion",        population_k: 173, region: "Crete",    country: "gr", quality: "good" },
  { value: "Larissa",          population_k: 144, region: "Thessaly", country: "gr", quality: "good" },
  { value: "Thessaloniki",     population_k: 325, region: "C-Macedonia", country: "gr", quality: "ok" },
  { value: "Athens",           population_k: 664, region: "Attica",  country: "gr", quality: "saturated" },

  // ──────────────────────── Australia ────────────────────────────
  { value: "Adelaide, SA",     population_k: 1402, region: "SA", country: "au", quality: "good" },
  { value: "Hobart, TAS",      population_k:  252, region: "TAS", country: "au", quality: "good" },
  { value: "Darwin, NT",       population_k:  140, region: "NT", country: "au", quality: "good" },
  { value: "Cairns, QLD",      population_k:  153, region: "QLD", country: "au", quality: "good" },
  { value: "Townsville, QLD",  population_k:  180, region: "QLD", country: "au", quality: "good" },
  { value: "Newcastle, NSW",   population_k:  322, region: "NSW", country: "au", quality: "ok" },
  { value: "Wollongong, NSW",  population_k:  306, region: "NSW", country: "au", quality: "ok" },
  { value: "Geelong, VIC",     population_k:  271, region: "VIC", country: "au", quality: "ok" },
  { value: "Gold Coast, QLD",  population_k:  679, region: "QLD", country: "au", quality: "ok" },
  { value: "Perth, WA",        population_k: 2192, region: "WA",  country: "au", quality: "ok" },
  { value: "Brisbane, QLD",    population_k: 2568, region: "QLD", country: "au", quality: "saturated" },
  { value: "Melbourne, VIC",   population_k: 5078, region: "VIC", country: "au", quality: "saturated" },
  { value: "Sydney, NSW",      population_k: 5312, region: "NSW", country: "au", quality: "saturated" },

  // ──────────────────────── New Zealand ──────────────────────────
  { value: "Hamilton",         population_k: 178, region: "Waikato", country: "nz", quality: "good" },
  { value: "Tauranga",         population_k: 158, region: "Bay of Plenty", country: "nz", quality: "good" },
  { value: "Dunedin",          population_k: 134, region: "Otago", country: "nz", quality: "good" },
  { value: "Napier",           population_k:  66, region: "Hawke's Bay", country: "nz", quality: "good" },
  { value: "Palmerston North", population_k:  91, region: "Manawatū", country: "nz", quality: "good" },
  { value: "Christchurch",     population_k: 396, region: "Canterbury", country: "nz", quality: "ok" },
  { value: "Wellington",       population_k: 215, region: "Wellington", country: "nz", quality: "ok" },
  { value: "Auckland",         population_k: 1463, region: "Auckland", country: "nz", quality: "saturated" },

  // ──────────────────────── Fiji ─────────────────────────────────
  { value: "Lautoka",          population_k:  72, region: "Western", country: "fj", quality: "good" },
  { value: "Suva",             population_k:  93, region: "Central", country: "fj", quality: "good" },

  // ──────────────────────── Philippines ──────────────────────────
  { value: "Cebu City",        population_k:  964, region: "Cebu",        country: "ph", quality: "good" },
  { value: "Davao City",       population_k: 1776, region: "Davao",       country: "ph", quality: "good" },
  { value: "Iloilo City",      population_k:  457, region: "Iloilo",      country: "ph", quality: "good" },
  { value: "Bacolod",          population_k:  600, region: "Negros Occ.", country: "ph", quality: "good" },
  { value: "Cagayan de Oro",   population_k:  728, region: "Misamis Or.", country: "ph", quality: "good" },
  { value: "Zamboanga City",   population_k:  977, region: "Zamboanga",   country: "ph", quality: "good" },
  { value: "General Santos",   population_k:  697, region: "S. Cotabato", country: "ph", quality: "good" },
  { value: "Tacloban",         population_k:  251, region: "Leyte",       country: "ph", quality: "good" },
  { value: "Baguio",           population_k:  366, region: "Benguet",     country: "ph", quality: "good" },
  { value: "Tagaytay",         population_k:   85, region: "Cavite",      country: "ph", quality: "good" },
  { value: "Quezon City",      population_k: 2960, region: "NCR",         country: "ph", quality: "ok" },
  { value: "Pasig",            population_k:  803, region: "NCR",         country: "ph", quality: "ok" },
  { value: "Makati",           population_k:  629, region: "NCR",         country: "ph", quality: "saturated" },
  { value: "Manila",           population_k: 1846, region: "NCR",         country: "ph", quality: "saturated" },

  // ──────────────────────── Indonesia ────────────────────────────
  { value: "Yogyakarta",       population_k:  423, region: "Yogyakarta", country: "id", quality: "good" },
  { value: "Malang",           population_k:  874, region: "E. Java",    country: "id", quality: "good" },
  { value: "Padang",           population_k:  909, region: "W. Sumatra", country: "id", quality: "good" },
  { value: "Semarang",         population_k: 1656, region: "C. Java",    country: "id", quality: "good" },
  { value: "Bandung",          population_k: 2452, region: "W. Java",    country: "id", quality: "ok" },
  { value: "Surabaya",         population_k: 2874, region: "E. Java",    country: "id", quality: "ok" },
  { value: "Medan",            population_k: 2435, region: "N. Sumatra", country: "id", quality: "ok" },
  { value: "Jakarta",          population_k: 10770, region: "DKI",       country: "id", quality: "saturated" },

  // ──────────────────────── Thailand ─────────────────────────────
  { value: "Chiang Mai",       population_k:  127, region: "N. Thailand", country: "th", quality: "good" },
  { value: "Khon Kaen",        population_k:  120, region: "NE",          country: "th", quality: "good" },
  { value: "Hat Yai",          population_k:  159, region: "Songkhla",    country: "th", quality: "good" },
  { value: "Pattaya",          population_k:  120, region: "Chonburi",    country: "th", quality: "good" },
  { value: "Phuket",           population_k:   80, region: "Phuket",      country: "th", quality: "ok" },
  { value: "Bangkok",          population_k: 8281, region: "Bangkok",     country: "th", quality: "saturated" },

  // ──────────────────────── Vietnam ──────────────────────────────
  { value: "Da Lat",           population_k:  226, region: "Lâm Đồng", country: "vn", quality: "good" },
  { value: "Nha Trang",        population_k:  535, region: "Khánh Hòa", country: "vn", quality: "good" },
  { value: "Hue",              population_k:  455, region: "T-T-Huế",   country: "vn", quality: "good" },
  { value: "Da Nang",          population_k: 1135, region: "Da Nang",   country: "vn", quality: "ok" },
  { value: "Can Tho",          population_k: 1235, region: "Can Tho",   country: "vn", quality: "ok" },
  { value: "Hai Phong",        population_k: 2029, region: "Hai Phong", country: "vn", quality: "ok" },
  { value: "Ho Chi Minh City", population_k: 9000, region: "HCMC",      country: "vn", quality: "saturated" },
  { value: "Hanoi",            population_k: 8200, region: "Hanoi",     country: "vn", quality: "saturated" },

  // ──────────────────────── Malaysia ─────────────────────────────
  { value: "Penang",           population_k: 794,  region: "Penang",    country: "my", quality: "good" },
  { value: "Johor Bahru",      population_k: 497,  region: "Johor",     country: "my", quality: "good" },
  { value: "Ipoh",             population_k: 759,  region: "Perak",     country: "my", quality: "good" },
  { value: "Kuching",          population_k: 325,  region: "Sarawak",   country: "my", quality: "good" },
  { value: "Kota Kinabalu",    population_k: 500,  region: "Sabah",     country: "my", quality: "good" },
  { value: "Shah Alam",        population_k: 641,  region: "Selangor",  country: "my", quality: "ok" },
  { value: "Kuala Lumpur",     population_k: 1808, region: "WP",        country: "my", quality: "ok" },

  // ──────────────────────── Singapore ────────────────────────────
  { value: "Singapore",        population_k: 5454, region: "Singapore", country: "sg", quality: "saturated" },

  // ──────────────────────── India ────────────────────────────────
  { value: "Indore",           population_k: 1964, region: "MP", country: "in", quality: "good" },
  { value: "Bhopal",           population_k: 1798, region: "MP", country: "in", quality: "good" },
  { value: "Lucknow",          population_k: 2817, region: "UP", country: "in", quality: "good" },
  { value: "Kanpur",           population_k: 2767, region: "UP", country: "in", quality: "good" },
  { value: "Patna",            population_k: 1684, region: "BR", country: "in", quality: "good" },
  { value: "Visakhapatnam",    population_k: 1730, region: "AP", country: "in", quality: "good" },
  { value: "Vadodara",         population_k: 1670, region: "GJ", country: "in", quality: "good" },
  { value: "Coimbatore",       population_k: 1050, region: "TN", country: "in", quality: "good" },
  { value: "Mysore",           population_k:  920, region: "KA", country: "in", quality: "good" },
  { value: "Jaipur",           population_k: 3046, region: "RJ", country: "in", quality: "ok" },
  { value: "Ahmedabad",        population_k: 5570, region: "GJ", country: "in", quality: "ok" },
  { value: "Pune",             population_k: 3124, region: "MH", country: "in", quality: "ok" },
  { value: "Hyderabad",        population_k: 6993, region: "TS", country: "in", quality: "ok" },
  { value: "Chennai",          population_k: 7088, region: "TN", country: "in", quality: "saturated" },
  { value: "Bangalore",        population_k: 8443, region: "KA", country: "in", quality: "saturated" },
  { value: "Delhi",            population_k: 16787, region: "DL", country: "in", quality: "saturated" },
  { value: "Mumbai",           population_k: 12442, region: "MH", country: "in", quality: "saturated" },

  // ──────────────────────── Japan ────────────────────────────────
  { value: "Niigata",          population_k:  789, region: "Niigata",  country: "jp", quality: "ok" },
  { value: "Sendai",           population_k: 1090, region: "Miyagi",   country: "jp", quality: "ok" },
  { value: "Hiroshima",        population_k: 1199, region: "Hiroshima", country: "jp", quality: "ok" },
  { value: "Fukuoka",          population_k: 1612, region: "Fukuoka",  country: "jp", quality: "saturated" },
  { value: "Sapporo",          population_k: 1973, region: "Hokkaidō", country: "jp", quality: "saturated" },
  { value: "Nagoya",           population_k: 2295, region: "Aichi",    country: "jp", quality: "saturated" },
  { value: "Osaka",            population_k: 2691, region: "Osaka",    country: "jp", quality: "saturated" },
  { value: "Tokyo",            population_k: 13929, region: "Tokyo",   country: "jp", quality: "saturated" },

  // ──────────────────────── South Korea ──────────────────────────
  { value: "Daejeon",          population_k: 1454, region: "Daejeon", country: "kr", quality: "ok" },
  { value: "Gwangju",          population_k: 1463, region: "Gwangju", country: "kr", quality: "ok" },
  { value: "Daegu",            population_k: 2429, region: "Daegu",   country: "kr", quality: "ok" },
  { value: "Busan",            population_k: 3349, region: "Busan",   country: "kr", quality: "saturated" },
  { value: "Seoul",            population_k: 9776, region: "Seoul",   country: "kr", quality: "saturated" },

  // ──────────────────────── Taiwan ───────────────────────────────
  { value: "Tainan",           population_k: 1875, region: "Tainan", country: "tw", quality: "ok" },
  { value: "Kaohsiung",        population_k: 2773, region: "Kaohsiung", country: "tw", quality: "ok" },
  { value: "Taichung",         population_k: 2810, region: "Taichung", country: "tw", quality: "ok" },
  { value: "Taipei",           population_k: 2602, region: "Taipei",   country: "tw", quality: "saturated" },

  // ──────────────────────── Hong Kong ────────────────────────────
  { value: "Hong Kong",        population_k: 7482, region: "Hong Kong", country: "hk", quality: "saturated" },

  // ──────────────────────── UAE ──────────────────────────────────
  { value: "Sharjah",          population_k: 1700, region: "Sharjah",  country: "ae", quality: "ok" },
  { value: "Ajman",             population_k: 540, region: "Ajman",    country: "ae", quality: "ok" },
  { value: "Al Ain",           population_k:  766, region: "Abu Dhabi", country: "ae", quality: "ok" },
  { value: "Abu Dhabi",        population_k: 1483, region: "Abu Dhabi", country: "ae", quality: "saturated" },
  { value: "Dubai",            population_k: 3604, region: "Dubai",    country: "ae", quality: "saturated" },

  // ──────────────────────── Saudi Arabia ─────────────────────────
  { value: "Medina",           population_k: 1488, region: "Medina", country: "sa", quality: "ok" },
  { value: "Dammam",           population_k: 1252, region: "E. Province", country: "sa", quality: "ok" },
  { value: "Mecca",            population_k: 2042, region: "Mecca",  country: "sa", quality: "ok" },
  { value: "Jeddah",           population_k: 4697, region: "Mecca",  country: "sa", quality: "saturated" },
  { value: "Riyadh",           population_k: 7676, region: "Riyadh", country: "sa", quality: "saturated" },

  // ──────────────────────── Israel ───────────────────────────────
  { value: "Be'er Sheva",      population_k:  213, region: "Southern", country: "il", quality: "ok" },
  { value: "Haifa",            population_k:  285, region: "Haifa",    country: "il", quality: "ok" },
  { value: "Tel Aviv",         population_k:  460, region: "Tel Aviv", country: "il", quality: "saturated" },
  { value: "Jerusalem",        population_k:  936, region: "Jerusalem", country: "il", quality: "saturated" },

  // ──────────────────────── Jordan ───────────────────────────────
  { value: "Irbid",            population_k:  570, region: "Irbid", country: "jo", quality: "good" },
  { value: "Zarqa",            population_k:  638, region: "Zarqa", country: "jo", quality: "good" },
  { value: "Amman",            population_k: 4007, region: "Amman", country: "jo", quality: "ok" },

  // ──────────────────────── South Africa ─────────────────────────
  { value: "Port Elizabeth",   population_k: 1263, region: "EC", country: "za", quality: "good" },
  { value: "East London",      population_k:  478, region: "EC", country: "za", quality: "good" },
  { value: "Bloemfontein",     population_k:  556, region: "FS", country: "za", quality: "good" },
  { value: "Polokwane",        population_k:  131, region: "LP", country: "za", quality: "good" },
  { value: "Nelspruit",        population_k:  111, region: "MP", country: "za", quality: "good" },
  { value: "Pretoria",         population_k: 2473, region: "GP", country: "za", quality: "ok" },
  { value: "Durban",           population_k: 3442, region: "KZN", country: "za", quality: "ok" },
  { value: "Johannesburg",     population_k: 5635, region: "GP", country: "za", quality: "saturated" },
  { value: "Cape Town",        population_k: 4618, region: "WC", country: "za", quality: "saturated" },

  // ──────────────────────── Nigeria ──────────────────────────────
  { value: "Ibadan",           population_k: 3565, region: "Oyo",     country: "ng", quality: "good" },
  { value: "Kano",             population_k: 3140, region: "Kano",    country: "ng", quality: "good" },
  { value: "Port Harcourt",    population_k: 1865, region: "Rivers",  country: "ng", quality: "good" },
  { value: "Benin City",       population_k: 1500, region: "Edo",     country: "ng", quality: "good" },
  { value: "Abuja",            population_k: 3464, region: "FCT",     country: "ng", quality: "ok" },
  { value: "Lagos",            population_k: 15388, region: "Lagos",  country: "ng", quality: "saturated" },

  // ──────────────────────── Kenya ────────────────────────────────
  { value: "Nakuru",           population_k:  570, region: "Nakuru",  country: "ke", quality: "good" },
  { value: "Eldoret",          population_k:  475, region: "Uasin Gishu", country: "ke", quality: "good" },
  { value: "Kisumu",           population_k:  610, region: "Kisumu",  country: "ke", quality: "good" },
  { value: "Mombasa",          population_k: 1208, region: "Mombasa", country: "ke", quality: "ok" },
  { value: "Nairobi",          population_k: 4397, region: "Nairobi", country: "ke", quality: "saturated" },

  // ──────────────────────── Ghana ────────────────────────────────
  { value: "Tamale",           population_k:  371, region: "N. Region", country: "gh", quality: "good" },
  { value: "Kumasi",           population_k: 3488, region: "Ashanti",   country: "gh", quality: "good" },
  { value: "Accra",            population_k: 2557, region: "G. Accra",  country: "gh", quality: "ok" },

  // ──────────────────────── Egypt ────────────────────────────────
  { value: "Mansoura",         population_k:  543, region: "Dakahlia", country: "eg", quality: "good" },
  { value: "Tanta",            population_k:  549, region: "Gharbia",  country: "eg", quality: "good" },
  { value: "Asyut",            population_k:  462, region: "Asyut",    country: "eg", quality: "good" },
  { value: "Giza",             population_k: 9277, region: "Giza",     country: "eg", quality: "ok" },
  { value: "Alexandria",       population_k: 5200, region: "Alexandria", country: "eg", quality: "ok" },
  { value: "Cairo",            population_k: 10230, region: "Cairo",   country: "eg", quality: "saturated" },

  // ──────────────────────── Morocco ──────────────────────────────
  { value: "Tangier",          population_k: 1065, region: "T-Tétouan",   country: "ma", quality: "good" },
  { value: "Fez",              population_k: 1112, region: "Fez-Meknès",  country: "ma", quality: "good" },
  { value: "Marrakesh",        population_k:  928, region: "Marrakesh",   country: "ma", quality: "ok" },
  { value: "Rabat",            population_k:  578, region: "Rabat",       country: "ma", quality: "ok" },
  { value: "Casablanca",       population_k: 3360, region: "Casablanca",  country: "ma", quality: "saturated" },

  // ──────────────────────── Brazil ───────────────────────────────
  { value: "Recife",           population_k: 1488, region: "PE", country: "br", quality: "good" },
  { value: "Manaus",           population_k: 2255, region: "AM", country: "br", quality: "good" },
  { value: "Goiânia",          population_k: 1555, region: "GO", country: "br", quality: "good" },
  { value: "Curitiba",         population_k: 1948, region: "PR", country: "br", quality: "ok" },
  { value: "Salvador",         population_k: 2418, region: "BA", country: "br", quality: "ok" },
  { value: "Belo Horizonte",   population_k: 2316, region: "MG", country: "br", quality: "ok" },
  { value: "Brasília",         population_k: 3094, region: "DF", country: "br", quality: "saturated" },
  { value: "Rio de Janeiro",   population_k: 6748, region: "RJ", country: "br", quality: "saturated" },
  { value: "São Paulo",        population_k: 12325, region: "SP", country: "br", quality: "saturated" },

  // ──────────────────────── Argentina ────────────────────────────
  { value: "Mendoza",          population_k:  115, region: "Mendoza",  country: "ar", quality: "good" },
  { value: "Salta",            population_k:  535, region: "Salta",    country: "ar", quality: "good" },
  { value: "Mar del Plata",    population_k:  618, region: "Bs. As.", country: "ar", quality: "good" },
  { value: "Rosario",          population_k: 1276, region: "Santa Fe", country: "ar", quality: "ok" },
  { value: "Córdoba",          population_k: 1565, region: "Córdoba",  country: "ar", quality: "ok" },
  { value: "Buenos Aires",     population_k: 3075, region: "CABA",     country: "ar", quality: "saturated" },

  // ──────────────────────── Chile ────────────────────────────────
  { value: "Antofagasta",      population_k:  391, region: "Antofagasta", country: "cl", quality: "good" },
  { value: "Concepción",       population_k:  223, region: "Biobío",   country: "cl", quality: "good" },
  { value: "Valparaíso",       population_k:  296, region: "Valparaíso", country: "cl", quality: "ok" },
  { value: "Santiago",         population_k: 6724, region: "RM",       country: "cl", quality: "saturated" },

  // ──────────────────────── Colombia ─────────────────────────────
  { value: "Bucaramanga",      population_k:  581, region: "Santander", country: "co", quality: "good" },
  { value: "Cúcuta",           population_k:  661, region: "N. Santander", country: "co", quality: "good" },
  { value: "Cartagena",        population_k:  876, region: "Bolívar",   country: "co", quality: "good" },
  { value: "Barranquilla",     population_k: 1206, region: "Atlántico", country: "co", quality: "ok" },
  { value: "Medellín",         population_k: 2533, region: "Antioquia", country: "co", quality: "ok" },
  { value: "Cali",             population_k: 2228, region: "V. Cauca",  country: "co", quality: "ok" },
  { value: "Bogotá",           population_k: 7181, region: "Bogotá",    country: "co", quality: "saturated" },

  // ──────────────────────── Peru ─────────────────────────────────
  { value: "Trujillo",         population_k:  919, region: "La Libertad", country: "pe", quality: "good" },
  { value: "Arequipa",         population_k: 1008, region: "Arequipa",   country: "pe", quality: "good" },
  { value: "Lima",             population_k: 9751, region: "Lima",      country: "pe", quality: "saturated" },

  // ──────────────────────── Caribbean ────────────────────────────
  { value: "Montego Bay",      population_k: 110, region: "St. James", country: "jm", quality: "good" },
  { value: "Kingston",         population_k: 580, region: "Kingston",  country: "jm", quality: "ok" },
  { value: "Port of Spain",    population_k:  37, region: "POS",       country: "tt", quality: "good" },
  { value: "San Fernando",     population_k:  82, region: "S. Fernando", country: "tt", quality: "good" },
  { value: "Santiago",         population_k: 1200, region: "Santiago", country: "do", quality: "good" },
  { value: "Santo Domingo",    population_k: 2908, region: "Distrito Nacional", country: "do", quality: "ok" },
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
) as Continent[];

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
  { niche: "house cleaning",      city: "Querétaro",       country: "mx" },
  { niche: "personal trainer",    city: "Yogyakarta",      country: "id" },
  { niche: "dog walker",          city: "Saskatoon, SK",   country: "ca" },
  { niche: "mobile car detailing", city: "Mendoza",        country: "ar" },
];
