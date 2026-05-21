/**
 * build-niche-samples.mjs — Build one premium-trades site per niche for QA.
 *
 * Inputs:  the 8 niche configs defined below (business name, address,
 *          category, variants, palette, photo IDs, copy)
 * Outputs: 8 dist directories under .tmp/niche-samples/<niche>/ plus an
 *          index.html that links to all of them for one-click QA review.
 * Used by: operator/QA — run via `node scripts/build-niche-samples.mjs`
 *
 * Goal: stress-test the template across niches with realistic data and
 * verify the new editorial-split hero (plus the rest of the library)
 * holds up everywhere. Photo IDs match the curated per-niche pools in
 * web/lib/data/stock-photos.ts. Each niche gets a different hero variant
 * so all 5 designs ship into the QA matrix.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TEMPLATE_DIR = join(REPO_ROOT, "templates", "premium-trades");
const DATA_JSON = join(TEMPLATE_DIR, "src", "data.json");
const DIST_DIR = join(TEMPLATE_DIR, "dist");
const OUTPUT_ROOT = join(REPO_ROOT, ".tmp", "niche-samples");

// ── node-vibrant resolution ──────────────────────────────────────────────────
// node-vibrant is installed in web/node_modules (it's a production-pipeline
// dependency, not script-level). Resolve through createRequire so we can use
// the SAME extraction logic that stage-2-enrich uses — proving the pipeline
// produces per-business palettes, not pre-fabricated niche palettes.
const requireFromWeb = createRequire(join(REPO_ROOT, "web", "package.json"));
async function loadVibrant() {
  try {
    const vibrantPath = requireFromWeb.resolve("node-vibrant/node");
    const mod = await import(pathToFileURL(vibrantPath).href);
    return mod.Vibrant ?? mod.default?.Vibrant ?? mod.default;
  } catch (err) {
    console.warn("[batch] node-vibrant unavailable, falling back:", err.message);
    return null;
  }
}

/**
 * Extract a brand color from the business's hero photo. Mirrors
 * web/lib/services/color-extractor.ts so the QA matrix proves that the
 * real pipeline produces unique palettes per business.
 */
async function extractBrandColor(Vibrant, photoUrl, fallback) {
  if (!Vibrant) return fallback;
  try {
    const palette = await Vibrant.from(photoUrl).getPalette();
    const swatch =
      palette.Vibrant ??
      palette.DarkVibrant ??
      palette.Muted ??
      palette.DarkMuted ??
      palette.LightVibrant;
    return swatch?.hex?.toUpperCase() ?? fallback;
  } catch (err) {
    console.warn(`[batch]   extract failed for ${photoUrl.slice(0, 60)}: ${err.message}`);
    return fallback;
  }
}

// ── Palette derivation — ported from web/lib/palette.ts ─────────────────────
// Takes a single seed hex (from photo extraction) and derives the full 7-token
// palette via HSL math. This is what the production pipeline does too.
function hexToRgb(hex) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
function textOn(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#FFFFFF";
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.5 ? "#1A1F26" : "#FFFFFF";
}
function derivePalette(brandHex) {
  const rgb = hexToRgb(brandHex);
  if (!rgb) {
    return {
      primary: "#1F4E79", primary_text: "#FFFFFF", accent: "#E07B00",
      surface: "#FFFFFF", surface_alt: "#F4F7FA",
      neutral_900: "#1A1F26", neutral_500: "#6B7280",
    };
  }
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const lClamped = Math.min(0.6, Math.max(0.35, l));
  const primary = hslToHex(h, s, lClamped);
  const accentHue = (h + 30 / 360) % 1;
  const accent = hslToHex(accentHue, Math.max(0.55, s), 0.5);
  const surface_alt = hslToHex(h, 0.18, 0.96);
  const neutral_900 = hslToHex(h, 0.08, 0.12);
  const neutral_500 = hslToHex(h, 0.08, 0.5);
  return {
    primary, primary_text: textOn(primary), accent,
    surface: "#FFFFFF", surface_alt, neutral_900, neutral_500,
  };
}

const PHOTO_PARAMS = "?w=1600&auto=format&fit=crop&q=80";
const ph = (id) => `https://images.unsplash.com/photo-${id}${PHOTO_PARAMS}`;

// ── Niche-keyed Unsplash IDs (mirrors web/lib/data/stock-photos.ts pools) ──
const PHOTOS = {
  "home-services": [
    "1676210134190-3f2c0d5cf58d", "1503387762-592deb58ef4e",
    "1662296416406-4ff3afef67fe", "1593583810872-ddee4d6bd55a",
    "1638037619854-759f888f40de", "1626436312908-bad0007396c0",
  ].map(ph),
  "landscaping-construction": [
    "1649427909612-353b0042ab79", "1651888433177-271001c0fc09",
    "1657736508697-4f0bfa8f1b47", "1657736508663-22146f6c00aa",
    "1710376300099-79cd5e7e1ae1", "1597201278257-3687be27d954",
  ].map(ph),
  "beauty-wellness": [
    "1626383137804-ff908d2753a2", "1488282687151-c5e6582e7cf1",
    "1560066984-138dadb4c035",    "1629397685944-7073f5589754",
    "1629397662600-50ad523ef4fb", "1675034743339-0b0747047727",
  ].map(ph),
  "professional-services": [
    "1718220216044-006f43e3a9b1", "1765371513492-264506c3ad09",
    "1765371512336-99c2b1c6975f", "1774853094610-89be6f1a7690",
    "1765371515218-0a4c992ba8e2", "1774853102013-d51ac73f52a5",
  ].map(ph),
  "food-beverage": [
    "1767778080869-4b82b5924c3a", "1775281562991-7396061db512",
    "1650772263983-daebce6959c5", "1628627582892-a7736b5be159",
    "1750672831807-02188adaa7b0", "1653491948158-9044bcbb9c5a",
  ].map(ph),
  "home-goods-vintage": [
    "1648939109875-d4f0c4f15b29", "1738541717422-2a332e7d7a65",
    "1652598631616-3f5f4d2cfbd5", "1647701586082-c0c5364a2acd",
    "1569424746512-4f98ac866469", "1753921156536-a9b79f9dfb4c",
  ].map(ph),
  "real-estate": [
    "1638972691611-69633a3d3127", "1640109478916-f445f8f19b11",
    "1639173925921-5d5fd027713c", "1612301988752-5a5b19021f45",
    "1638541363822-6f4c189b5cf7", "1715985160053-d339e8b6eb94",
  ].map(ph),
  "fitness-pet": [
    "1775993703558-e7afab02b7bd", "1758448756350-3d0eec02ba37",
    "1776710669971-eebdde536700", "1766031263281-43cdaa6e624a",
    "1776710669732-177e69dd582d", "1761971976003-dc348a4f2fa1",
  ].map(ph),
};

// ── 8 niche configs — realistic Austin-area businesses, niche-appropriate
//    palettes, distinct hero variants so the QA matrix covers the library ──
const NICHES = [
  {
    slug: "home-services",
    business_name: "Joe's Plumbing",
    phone: "(512) 555-0142",
    email: "joe@joesplumbingatx.com",
    address: "1200 S Lamar Blvd, Austin, TX 78704",
    category: "Plumber",
    rating: 4.9,
    review_count: 287,
    palette: { primary: "#1F4E79", primary_text: "#FFFFFF", accent: "#E07B00",
               surface: "#FFFFFF", surface_alt: "#F4F7FA",
               neutral_900: "#1A1F26", neutral_500: "#6B7280" },
    hero: "editorial-split",
    theme: { background: "plain", button_style: "shining-sweep", font_pair: "modern-sans" },
    service_areas: ["South Austin","Downtown","Bouldin","Zilker","Travis Heights","Round Rock","Cedar Park","Pflugerville"],
    business_hours: { mon:"7am – 6pm",tue:"7am – 6pm",wed:"7am – 6pm",thu:"7am – 6pm",fri:"7am – 6pm",sat:"8am – 2pm",sun:"Emergency only" },
    copy: {
      hero_tagline: "When your pipes burst at 2am, Joe's already on the way.",
      hero_subhead: "Family-run plumbing in South Austin. Licensed, insured, and always picks up the phone.",
      trust_strip: ["Licensed & Insured","15+ years in Austin","Same-day emergency response","Upfront pricing"],
      about_paragraph: "Joe's Plumbing has been keeping South Austin homes dry for fifteen years. Family-run, licensed, and always picks up the phone — even at 2am.",
      about_why_us: ["Same-night response for water emergencies","Quotes given on the phone, not after we arrive","Licensed master plumber on every call","Five-year warranty on every install"],
      services: [
        { slug:"emergency-repairs", name:"Emergency repairs", short_description:"Same-night response for burst pipes, leaks, and clogged drains.", detail_paragraph:"When water is going where it shouldn't, every minute is damage. We answer after hours, dispatch within the hour, and most jobs are fully resolved on the same visit.", bullets:["Same-night response, 7 days a week","Burst pipe + leak repair","Clogged drains & sewer back-ups","Sump pump failures"] },
        { slug:"water-heater", name:"Water heater install", short_description:"Tank or tankless, installed in under a day.", detail_paragraph:"Replacing a heater is usually a 4–6 hour job and we'll have you back in hot water the same day. We help you pick the right size for the household.", bullets:["Tank and tankless options","Same-day install most calls","Permit + inspection handled","5-year parts & labor warranty"] },
        { slug:"drain-cleaning", name:"Drain cleaning", short_description:"Snake, hydrojet, and camera inspection.", detail_paragraph:"If a clog comes back within a month, you don't have a clog — you have a line problem. We start with a snake, escalate to hydrojetting if needed.", bullets:["Mainline & branch clearing","Hydrojet for grease and roots","In-line camera inspection","Free re-clear within 30 days"] },
      ],
      service_area_intro: "We're based in South Austin and cover most of the metro within 30 minutes of dispatch.",
      contact_blurb: "Tell us what's going on and we'll quote it on the call. No fake-trip charges.",
      meta_description: "Family-run plumbing in South Austin. Licensed, insured, same-night emergency service.",
      cta_primary: "Get a Free Quote", cta_secondary: "Call Now",
      social_proof_line: "Trusted by 280+ Austin homeowners", urgency_micro: "Same-day calls answered",
    },
    reviews: [
      {author:"Mark T.",rating:5,text:"Joe came out at 11pm when our water heater burst. Fixed it the same night."},
      {author:"Sarah L.",rating:5,text:"Honest pricing, did exactly what he said he would. We use him for everything now."},
      {author:"Diego R.",rating:5,text:"Quoted us on the phone, showed up on time, no surprise charges."},
      {author:"Priya K.",rating:5,text:"Replaced our 22-year-old water heater in three hours. House feels new."},
    ],
  },
  {
    slug: "landscaping-construction",
    business_name: "Greene Earth Co.",
    phone: "(512) 555-0184",
    email: "hello@greeneearthco.com",
    address: "4400 E Riverside Dr, Austin, TX 78741",
    category: "Landscape Designer",
    rating: 4.8, review_count: 142,
    palette: { primary: "#2F5233", primary_text: "#F5F1E8", accent: "#C9A95C",
               surface: "#FAFAF6", surface_alt: "#EFEFE6",
               neutral_900: "#1F2820", neutral_500: "#6F7569" },
    hero: "parallax-photos",
    theme: { background: "aurora-blobs", button_style: "shining-sweep", font_pair: "modern-sans" },
    service_areas: ["East Austin","Mueller","Tarrytown","Westlake","Lakeway","Bee Cave","Dripping Springs"],
    business_hours: { mon:"7am – 5pm",tue:"7am – 5pm",wed:"7am – 5pm",thu:"7am – 5pm",fri:"7am – 5pm",sat:"By appointment",sun:"Closed" },
    copy: {
      hero_tagline: "Yards that look like Texas, not the catalogue.",
      hero_subhead: "Drought-tolerant design, native plantings, and stonework that lasts a generation. East Austin and the surrounding hills.",
      trust_strip: ["Native-plant certified","10+ years designing yards","Free site walkthrough","Workmanship warranty"],
      about_paragraph: "Greene Earth Co. designs yards the way Hill Country looked before the developers got here — drought-tolerant, native, and built to last.",
      about_why_us: ["Site walkthrough before any quote","Design + install handled by the same crew","Drought-tolerant native plantings","Stone + masonry done in-house"],
      services: [
        { slug:"landscape-design", name:"Landscape design", short_description:"Custom plans, renderings, and plant lists for your lot.", detail_paragraph:"We walk your site, study the light + drainage, and come back with a plan that fits how you actually use the yard. Renderings included.", bullets:["On-site consultation","3D renderings","Plant list + sourcing","Phased install options"] },
        { slug:"hardscape-stonework", name:"Hardscape & stonework", short_description:"Limestone walls, flagstone patios, custom fire features.", detail_paragraph:"Our masons cut local limestone and build retaining walls, patios, and fire pits the way they were built a hundred years ago — to outlast the house.", bullets:["Limestone retaining walls","Flagstone patios","Custom fire features","Drainage solutions"] },
        { slug:"native-planting", name:"Native plantings", short_description:"Drought-tolerant, pollinator-friendly, low-maintenance.", detail_paragraph:"We plant what actually grows here — Texas sage, blackfoot daisy, bluebonnets — sourced from regional nurseries that grow for Hill Country soil.", bullets:["Pollinator gardens","Xeriscape design","Native tree planting","Irrigation efficiency audit"] },
      ],
      service_area_intro: "We work the eastern half of Austin and the Hill Country towns — Lakeway, Bee Cave, Dripping Springs.",
      contact_blurb: "Tell us what you're working with and we'll come walk the lot — no charge.",
      meta_description: "Native landscape design + stonework for Austin and the Hill Country.",
      cta_primary: "Book a Walkthrough", cta_secondary: "Call Us",
      social_proof_line: "140+ Hill Country yards transformed", urgency_micro: "Now booking spring installs",
    },
    reviews: [
      {author:"Helen B.",rating:5,text:"They walked the lot with us for two hours before quoting. The plan is better than anything we'd have asked for."},
      {author:"Travis P.",rating:5,text:"The limestone wall they built looks like it's been there 50 years. Worth every penny."},
      {author:"Carmen R.",rating:5,text:"Took out our thirsty St. Augustine and replaced with natives. Water bill is half what it was."},
    ],
  },
  {
    slug: "beauty-wellness",
    business_name: "Bloom Hair Studio",
    phone: "(512) 555-0119",
    email: "hello@bloomhair.studio",
    address: "1400 E 6th St, Austin, TX 78702",
    category: "Hair Salon",
    rating: 4.9, review_count: 312,
    palette: { primary: "#B86A75", primary_text: "#FFFFFF", accent: "#D4AF7A",
               surface: "#FBF7F4", surface_alt: "#F2E9E2",
               neutral_900: "#2A1F23", neutral_500: "#7A6B70" },
    hero: "editorial-split",
    theme: { background: "aurora-blobs", button_style: "solid", font_pair: "fashion-italic" },
    service_areas: ["East Austin","Downtown","Mueller","Hyde Park","Travis Heights"],
    business_hours: { mon:"Closed",tue:"10am – 8pm",wed:"10am – 8pm",thu:"10am – 8pm",fri:"10am – 8pm",sat:"9am – 6pm",sun:"By appointment" },
    copy: {
      hero_tagline: "Hair that grows with you, not against you.",
      hero_subhead: "East Austin's color-first studio. Balayage, lived-in highlights, and cuts that work the morning after.",
      trust_strip: ["Balayage specialists","Olaplex-certified","Vegan + cruelty-free","9-year color archive"],
      about_paragraph: "Bloom opened in 2016 on East 6th with one chair and a focus on lived-in color. Six chairs and three stylists later, we still book one client at a time.",
      about_why_us: ["One client per stylist per appointment","Color consultation included","Ammonia-free + vegan lines","Color-archive — your formula stays with you"],
      services: [
        { slug:"balayage", name:"Balayage & highlights", short_description:"Hand-painted color that grows out beautifully.", detail_paragraph:"Each section is hand-painted to the way your hair falls and the way light hits your face — never foil-stripe uniform. Plan on 3-4 hours.", bullets:["Hand-painted technique","Custom toner blend","Olaplex bonding included","Take-home care plan"] },
        { slug:"precision-cut", name:"Precision cut + blowout", short_description:"Cuts engineered around your hair's natural fall.", detail_paragraph:"A real consultation, dry-cut shaping, then a wet refinement and blowout. The cut should work the next morning without 20 minutes of styling.", bullets:["Dry-cut shaping","Custom layering","Style-coaching included","Round-brush blowout"] },
        { slug:"color-correction", name:"Color correction", short_description:"Out-of-the-box-to-back-on-track in one or two sessions.", detail_paragraph:"Box dye gone wrong, brassy highlights, a tone that just won't sit. We assess in person and quote a realistic path back — usually 1-2 sessions.", bullets:["In-person assessment","Phased correction plan","Bond-rebuilder included","No surprises billing"] },
      ],
      service_area_intro: "We're the East Austin destination salon — most clients come from East 6th, Mueller, and Hyde Park.",
      contact_blurb: "Walk-ins welcome for cuts. Color always books out 2 weeks, so call ahead.",
      meta_description: "East Austin balayage + lived-in color salon. Olaplex-certified, vegan, by appointment.",
      cta_primary: "Book an Appointment", cta_secondary: "Call the Salon",
      social_proof_line: "310+ five-star reviews", urgency_micro: "Booking 2 weeks out",
    },
    reviews: [
      {author:"Lila K.",rating:5,text:"I've been going to Maya for four years. She knows my hair better than I do."},
      {author:"Sam V.",rating:5,text:"Got a color correction here after a salon disaster. They were honest about how many sessions, and now I trust my color again."},
      {author:"Erin G.",rating:5,text:"The space is calm, the work is exceptional. Worth booking out for."},
    ],
  },
  {
    slug: "professional-services",
    business_name: "Lakeside Law PLLC",
    phone: "(512) 555-0167",
    email: "intake@lakesidelaw.tx",
    address: "823 Congress Ave, Suite 700, Austin, TX 78701",
    category: "Estate Planning Attorney",
    rating: 5.0, review_count: 78,
    palette: { primary: "#1B2C4A", primary_text: "#F5EFE0", accent: "#B89455",
               surface: "#FAF8F4", surface_alt: "#E8E4DA",
               neutral_900: "#14161A", neutral_500: "#5C6470" },
    hero: "premium-hero",
    theme: { background: "plain", button_style: "shimmer", font_pair: "classical-serif" },
    service_areas: ["Austin","Round Rock","Cedar Park","Lakeway","Westlake","Bee Cave"],
    business_hours: { mon:"9am – 5pm",tue:"9am – 5pm",wed:"9am – 5pm",thu:"9am – 5pm",fri:"9am – 3pm",sat:"By appointment",sun:"Closed" },
    copy: {
      hero_tagline: "Estate planning that's clear, complete, and built to outlast you.",
      hero_subhead: "Trusts, wills, and probate guidance for Austin families. Flat fees on every engagement, signed before any work begins.",
      trust_strip: ["Texas State Bar #00012345","20+ years in practice","Flat-fee billing","Free 30-min consultation"],
      about_paragraph: "Lakeside Law has helped Central Texas families plan their estates for two decades. Our practice is intentionally small so every client works directly with the attorney handling their file.",
      about_why_us: ["Direct attorney access — no paralegal handoffs","Flat fees, signed engagement letter before work","Plain-English documents you can actually read","Annual review included for 3 years after signing"],
      services: [
        { slug:"trusts-and-wills", name:"Trusts & wills", short_description:"Revocable trusts, pour-over wills, and powers of attorney.", detail_paragraph:"A complete estate plan that keeps your family out of probate court. We draft, walk you through every clause, and handle execution and funding.", bullets:["Revocable living trust","Pour-over will","Durable power of attorney","HIPAA + medical directive"] },
        { slug:"probate-administration", name:"Probate administration", short_description:"Guidance for executors and beneficiaries through Travis County probate.", detail_paragraph:"When a family member passes, the executor's job can take 6–18 months. We handle filings, communicate with beneficiaries, and keep the process moving.", bullets:["Initial filing + Letters Testamentary","Creditor notice + claims","Asset distribution","Final accounting + closing"] },
        { slug:"business-succession", name:"Business succession", short_description:"Transitioning ownership without disrupting operations.", detail_paragraph:"For closely-held businesses, succession is half tax planning and half family dynamics. We draft the documents and help moderate the conversations.", bullets:["Buy-sell agreements","Family business transitions","Tax-efficient ownership transfer","Successor key-employee planning"] },
      ],
      service_area_intro: "We represent clients throughout the Austin metro and Hill Country — most files signed in our Congress Avenue office.",
      contact_blurb: "Send us a brief note about your situation. We'll respond within one business day.",
      meta_description: "Austin estate-planning attorney. Trusts, wills, probate. Flat-fee engagements.",
      cta_primary: "Request a Consultation", cta_secondary: "Call Our Office",
      social_proof_line: "78 verified five-star reviews", urgency_micro: "Same-week consultations available",
    },
    reviews: [
      {author:"Eleanor M.",rating:5,text:"David walked us through every scenario we hadn't considered. The trust documents are remarkably readable."},
      {author:"James W.",rating:5,text:"Flat-fee billing was a relief after a previous firm. No surprises, and the work is impeccable."},
      {author:"Patricia H.",rating:5,text:"Handled my father's probate from start to finish. They returned every call same-day."},
    ],
  },
  {
    slug: "food-beverage",
    business_name: "Veracruz Tacos",
    phone: "(512) 555-0193",
    email: "hola@veracruztacos.com",
    address: "2818 E Cesar Chavez St, Austin, TX 78702",
    category: "Mexican Restaurant",
    rating: 4.7, review_count: 1843,
    palette: { primary: "#C0392B", primary_text: "#FFF5E1", accent: "#F1C40F",
               surface: "#FBF6EE", surface_alt: "#F4E6CC",
               neutral_900: "#2A1810", neutral_500: "#7A6052" },
    hero: "full-bleed-photo",
    theme: { background: "aurora-blobs", button_style: "shining-sweep", font_pair: "editorial-serif" },
    service_areas: ["East Austin","Cesar Chavez corridor","Downtown delivery zone"],
    business_hours: { mon:"7am – 9pm",tue:"7am – 9pm",wed:"7am – 9pm",thu:"7am – 9pm",fri:"7am – 10pm",sat:"8am – 10pm",sun:"8am – 9pm" },
    copy: {
      hero_tagline: "The migas taco people stand in line for. Every morning since 2008.",
      hero_subhead: "Tortillas pressed at 6am. Salsas made in the parking lot. Lines out the door by 9.",
      trust_strip: ["Open daily 7am","Tortillas made in-house","Catering for 10–200","Cesar Chavez since 2008"],
      about_paragraph: "Reyna and Maritza López started Veracruz in 2008 as a single truck on Cesar Chavez. Today there are two trucks and a permanent space, but the migas taco hasn't changed.",
      about_why_us: ["Tortillas pressed and cooked the same morning","Salsa verde made fresh — not from a jar","Family-run, family-staffed","Cash + card, same price"],
      services: [
        { slug:"breakfast-tacos", name:"Breakfast tacos", short_description:"Migas, chorizo + egg, papas + bacon, and the famous bean + cheese.", detail_paragraph:"The migas comes with eggs, tortilla chips, jack cheese, and roasted tomato salsa. Order three. Don't be a hero and order two.", bullets:["Migas","Chorizo & egg","Bean & cheese","Papas con bacon"] },
        { slug:"al-pastor", name:"Al pastor & dinner tacos", short_description:"Trompo-roasted pork, beef barbacoa, and grilled chicken.", detail_paragraph:"Lunch and dinner — al pastor sliced off the spinning trompo, slow-cooked barbacoa, and tomatillo-marinated chicken. Three per order.", bullets:["Al pastor","Beef barbacoa","Tinga de pollo","Sides of frijoles + arroz"] },
        { slug:"catering", name:"Catering & private events", short_description:"Office breakfasts, parties, weddings — 10 to 200 people.", detail_paragraph:"We bring the trompo and the comal to your event. Office breakfasts, weddings, birthdays. 48-hour notice for groups over 50.", bullets:["On-site cooking","Full menu options","48-hour booking minimum","Service staff included"] },
      ],
      service_area_intro: "Walk-up at the trucks on Cesar Chavez, delivery downtown, and catering anywhere in the metro.",
      contact_blurb: "Call ahead for catering. For breakfast tacos, just come hungry.",
      meta_description: "Cesar Chavez breakfast tacos since 2008. Tortillas made fresh every morning.",
      cta_primary: "Order Online", cta_secondary: "Call the Truck",
      social_proof_line: "1,840+ five-star reviews on Google", urgency_micro: "Open every day from 7am",
    },
    reviews: [
      {author:"Brandon T.",rating:5,text:"I drive across town for these. Migas with extra salsa verde. There's nothing better in Austin."},
      {author:"Sofia A.",rating:5,text:"Catered our wedding. 130 people, hot food, fast service. Everyone is still talking about the al pastor."},
      {author:"Henry K.",rating:5,text:"Real tortillas. You can tell. Three tacos and an horchata and your day is made."},
    ],
  },
  {
    slug: "home-goods-vintage",
    business_name: "Mimi Estate Sales",
    phone: "(512) 555-0156",
    email: "mimi@mimiestates.com",
    address: "5614 Burnet Rd, Austin, TX 78756",
    category: "Estate Sale Service",
    rating: 4.9, review_count: 91,
    palette: { primary: "#7A5C42", primary_text: "#FBF5E8", accent: "#A89878",
               surface: "#FAF7F1", surface_alt: "#EFE7D6",
               neutral_900: "#2E2417", neutral_500: "#7D6F58" },
    hero: "editorial-split",
    theme: { background: "aurora-blobs", button_style: "solid", font_pair: "fashion-italic" },
    service_areas: ["Austin","Round Rock","Cedar Park","Lakeway","Westlake","Georgetown"],
    business_hours: { mon:"By appointment",tue:"By appointment",wed:"By appointment",thu:"10am – 4pm",fri:"10am – 4pm",sat:"9am – 3pm",sun:"Closed" },
    copy: {
      hero_tagline: "Estate sales done with the care your mother kept the house.",
      hero_subhead: "Full-service estate liquidation for Austin families. Catalog, price, host, and clean — handled.",
      trust_strip: ["20 years in business","Bonded + insured","Charity partnerships","No-charge consultation"],
      about_paragraph: "Mimi has helped Austin families through downsizes, moves, and losses for two decades. Every sale is run with the dignity the home deserves.",
      about_why_us: ["Free in-home consultation","Catalog + photograph every piece","Pricing research on collectibles","Donation + haul-away for leftovers"],
      services: [
        { slug:"full-estate-sale", name:"Full-service estate sale", short_description:"Catalog, price, stage, market, host, and settle.", detail_paragraph:"From the first walk-through to the final settlement check, we handle everything. Typical timeline is 3-4 weeks from contract to sale weekend.", bullets:["In-home consultation","Item cataloging + research","Pricing + marketing","Sale weekend + settlement"] },
        { slug:"buyout", name:"Estate buyouts", short_description:"One-check resolution for time-sensitive moves.", detail_paragraph:"When timing matters more than maximizing return, a buyout gets the house empty in a week. We make a fair offer based on a walkthrough.", bullets:["48-hour offer","One-week timeline","Cash settlement","Optional clean-out"] },
        { slug:"appraisal", name:"Appraisal & consultation", short_description:"Insurance, divorce, and estate-distribution appraisals.", detail_paragraph:"Certified appraisal reports for legal or insurance purposes. Useful for estate distribution, divorce settlements, and homeowner's policy updates.", bullets:["Certified written reports","Photography + provenance","Insurance + legal acceptance","Confidential handling"] },
      ],
      service_area_intro: "We work the Austin metro and surrounding towns — most sales held within 30 miles of downtown.",
      contact_blurb: "Send a few photos and a brief note. We'll set a free walkthrough within a week.",
      meta_description: "Austin estate sale + liquidation service. Twenty years of careful, full-service work.",
      cta_primary: "Schedule a Consultation", cta_secondary: "Call Mimi",
      social_proof_line: "90+ families served, five stars", urgency_micro: "Booking 4 weeks out",
    },
    reviews: [
      {author:"Margaret L.",rating:5,text:"Mimi handled my mother's estate with such care. The sale netted more than I expected and the house was spotless after."},
      {author:"Robert C.",rating:5,text:"They knew what was valuable and what wasn't, and priced it honestly. No drama, all professionalism."},
      {author:"Anita G.",rating:5,text:"Three weeks from first call to a check in hand. Recommended without reservation."},
    ],
  },
  {
    slug: "real-estate",
    business_name: "Heart of Austin Realty",
    phone: "(512) 555-0124",
    email: "team@heartofaustinrealty.com",
    address: "1311 W 35th St, Austin, TX 78703",
    category: "Real Estate Agency",
    rating: 4.9, review_count: 211,
    palette: { primary: "#274060", primary_text: "#F4EFE6", accent: "#C8A165",
               surface: "#FBFAF6", surface_alt: "#EBE6DA",
               neutral_900: "#1A1F26", neutral_500: "#6B7280" },
    hero: "split-with-stats",
    theme: { background: "animated-gradient-mesh", button_style: "shimmer", font_pair: "classical-serif" },
    service_areas: ["Tarrytown","Clarksville","Travis Heights","Bouldin","Hyde Park","Mueller","Westlake","Barton Hills"],
    business_hours: { mon:"9am – 7pm",tue:"9am – 7pm",wed:"9am – 7pm",thu:"9am – 7pm",fri:"9am – 7pm",sat:"10am – 6pm",sun:"By appointment" },
    copy: {
      hero_tagline: "We know every street in central Austin. So should your agent.",
      hero_subhead: "Boutique brokerage focused exclusively on central and west Austin. Twelve agents, one office, and a hundred and forty closings a year.",
      trust_strip: ["140+ closings annually","12 senior agents","Local since 2009","Top 1% Austin Board"],
      about_paragraph: "Heart of Austin Realty was founded by Tarrytown locals who wanted a brokerage that worked for the buyer or the seller — never both. We've kept that line since 2009.",
      about_why_us: ["Dedicated buyer's or seller's agent — never both","Specialty in central and west Austin","In-house staging + photography","Closing-week concierge"],
      services: [
        { slug:"buy", name:"Buying with us", short_description:"From first showings to a closed file, with no surprise fees.", detail_paragraph:"Buyers get one agent for the whole process — the same person who toured the home with you sits with you at closing. No team handoffs.", bullets:["Single-agent process","Inspection + repair negotiation","Lender + title coordination","Closing-week concierge"] },
        { slug:"sell", name:"Selling your home", short_description:"Strategic pricing, in-house staging, and aggressive marketing.", detail_paragraph:"Our seller's process starts 30 days before list date — declutter consultation, staging, professional photography, and a coordinated marketing push.", bullets:["Pre-list staging + photography","Active marketing 30 days pre-list","Negotiated commission tiers","Closing coordination"] },
        { slug:"investment", name:"Investment properties", short_description:"Long-term rentals, short-term, and 1031 exchanges.", detail_paragraph:"For investors building portfolios in Austin, we model cap rates, advise on submarket selection, and coordinate 1031 exchange timelines.", bullets:["Cap rate + ROI modeling","Submarket analysis","1031 exchange coordination","Property management referrals"] },
      ],
      service_area_intro: "Our specialty is central and west Austin — Tarrytown, Clarksville, Travis Heights, Bouldin, Hyde Park, Mueller, Westlake, Barton Hills.",
      contact_blurb: "Buying, selling, or just curious what your home is worth? We respond within the hour during business days.",
      meta_description: "Boutique Austin brokerage specializing in central and west Austin.",
      cta_primary: "Schedule a Consultation", cta_secondary: "Call the Office",
      social_proof_line: "210+ five-star reviews", urgency_micro: "Same-day showings available",
    },
    reviews: [
      {author:"Andrew J.",rating:5,text:"Sold our Hyde Park bungalow above asking in five days. Their pre-list staging made all the difference."},
      {author:"Kerry H.",rating:5,text:"As first-time buyers we had a thousand questions. Sara answered every single one and we got the house."},
      {author:"Marcus F.",rating:5,text:"They walked me through a 1031 exchange end to end. Honest about what would and wouldn't work."},
    ],
  },
  {
    slug: "fitness-pet",
    business_name: "South Austin CrossFit",
    phone: "(512) 555-0102",
    email: "info@southaustincf.com",
    address: "2900 S Lamar Blvd, Austin, TX 78704",
    category: "CrossFit Gym",
    rating: 4.9, review_count: 168,
    palette: { primary: "#1E2A38", primary_text: "#FFFFFF", accent: "#E8C547",
               surface: "#F7F7F5", surface_alt: "#E5E5E0",
               neutral_900: "#0F1419", neutral_500: "#5C6470" },
    hero: "full-bleed-photo",
    theme: { background: "animated-gradient-mesh", button_style: "shining-sweep", font_pair: "industrial-bold" },
    service_areas: ["South Austin","Bouldin","Travis Heights","Zilker","Barton Hills"],
    business_hours: { mon:"5am – 9pm",tue:"5am – 9pm",wed:"5am – 9pm",thu:"5am – 9pm",fri:"5am – 8pm",sat:"7am – 1pm",sun:"8am – 12pm" },
    copy: {
      hero_tagline: "Show up. We'll do the programming.",
      hero_subhead: "Group classes, personal coaching, and a community that's been showing up at 5am since 2012. South Lamar, no contract.",
      trust_strip: ["Open since 2012","Certified coaches","No long contracts","Free first week"],
      about_paragraph: "South Austin CrossFit has been the South Lamar gym since 2012. Group classes, personal coaching, and a community of regulars who actually know each other's names.",
      about_why_us: ["Programming changes daily — never the same workout twice","Certified L2+ coaches on every class","Beginners always welcome — first week free","No long-term contracts"],
      services: [
        { slug:"group-classes", name:"Group classes", short_description:"60 minutes of programmed strength + conditioning.", detail_paragraph:"Each class follows the day's programming — warm-up, strength piece, met-con, and cool-down. Beginners get scaled options on every movement.", bullets:["Daily programmed workouts","Beginner scaling","60-minute classes","6am–7pm class times"] },
        { slug:"personal-coaching", name:"Personal coaching", short_description:"One-on-one programming and form work.", detail_paragraph:"For specific goals — competition prep, post-injury return, or just learning the lifts in private. Hour-long sessions, two to three a week.", bullets:["Individualized programming","Video review of lifts","Two to three sessions per week","Goal-specific tracking"] },
        { slug:"beginners-program", name:"Beginners on-ramp", short_description:"Three-class intro covering every CrossFit movement.", detail_paragraph:"Three coached classes before joining group programming. We cover the lifts, the gymnastic movements, and the lingo so day one feels manageable.", bullets:["Three-class introduction","Movement screen","Goal-setting conversation","Joins group classes after"] },
      ],
      service_area_intro: "We serve the South Austin neighborhoods — South Lamar, Bouldin, Travis Heights, Zilker.",
      contact_blurb: "First week is free. Text us and we'll get you on the schedule.",
      meta_description: "South Austin CrossFit gym on South Lamar. Group classes, coaching, no contract.",
      cta_primary: "Claim Your Free Week", cta_secondary: "Text Us",
      social_proof_line: "160+ five-star reviews", urgency_micro: "Free first week — no card",
    },
    reviews: [
      {author:"Tasha B.",rating:5,text:"I've been coming five days a week for three years. The coaches actually know my form."},
      {author:"Dev S.",rating:5,text:"Came in nervous as a beginner. The on-ramp made it feel doable. Now I'm a regular."},
      {author:"Maria P.",rating:5,text:"Best gym I've belonged to. Community, programming, coaching — all top tier."},
    ],
  },
];

// ── Per-niche section recipes — controls which sections render + order.
//    Niches not listed get the DEFAULT (hero/trust/services/reviews/area/cta).
const SECTION_RECIPES = {
  "home-services":            ["hero","trust","services","reviews","service-area","cta"],
  "landscaping-construction": ["hero","trust","services","reviews","service-area","cta"],
  "beauty-wellness":          ["hero","team-grid","services","before-after","reviews","cta"],
  "professional-services":    ["hero","trust","services","reviews","faq","cta"],
  "food-beverage":            ["hero","menu-highlights","service-area","reviews","cta"],
  "home-goods-vintage":       ["hero","trust","services","reviews","service-area","cta"],
  "real-estate":              ["hero","services","team-grid","reviews","faq","cta"],
  "fitness-pet":              ["hero","services","team-grid","before-after","reviews","cta"],
};

// ── Per-niche visual signature — saturation, surface, type, geometry.
//    Base.astro carries niche-appropriate defaults so this is the
//    "explicit signature" demo path (proves the system works end-to-end).
const SIGNATURES = {
  "home-services":            { saturation: "balanced",            surface: "cream-wash",  type_scale: "display-serif-tight", geometry: "tight" },
  "landscaping-construction": { saturation: "desaturated",          surface: "warm-noisy",  type_scale: "display-serif-tight", geometry: "tight" },
  "beauty-wellness":          { saturation: "high",                 surface: "blush-wash",  type_scale: "editorial-thin",       geometry: "generous" },
  "professional-services":    { saturation: "desaturated",          surface: "paper-grain", type_scale: "display-serif-tight", geometry: "square" },
  "food-beverage":            { saturation: "high",                 surface: "warm-noisy",  type_scale: "editorial-thin",       geometry: "soft" },
  "home-goods-vintage":       { saturation: "desaturated",          surface: "warm-noisy",  type_scale: "editorial-thin",       geometry: "soft" },
  "real-estate":              { saturation: "balanced",            surface: "cream-wash",  type_scale: "display-serif-tight", geometry: "tight" },
  "fitness-pet":              { saturation: "high-contrast-dark",   surface: "near-black",  type_scale: "condensed-bold",       geometry: "square" },
};

// ── Per-niche extra content (team members, before/after pairs, FAQ, menu).
//    Only populated where the section recipe actually renders these.
//    Photos reuse the niche pool so imagery stays coherent.
const EXTRA_CONTENT = {
  "beauty-wellness": {
    team_members: [
      { name: "Maya Reyes",      role: "Master Colorist", photo: PHOTOS["beauty-wellness"][0], bio_short: "Twelve years specializing in lived-in balayage and color correction. Trained at Sassoon London." },
      { name: "Joss Park",       role: "Senior Stylist",  photo: PHOTOS["beauty-wellness"][1], bio_short: "Cuts engineered around the way your hair actually falls. Loves a precision bob." },
      { name: "Alana Whitfield", role: "Stylist + Color", photo: PHOTOS["beauty-wellness"][2], bio_short: "Texture specialist. Curly hair, coily hair, and color that respects pattern." },
    ],
    before_after: [
      { before_photo: PHOTOS["beauty-wellness"][3], after_photo: PHOTOS["beauty-wellness"][4], caption: "Color correction from box-dye brass to soft lived-in copper. Two sessions, three weeks apart." },
      { before_photo: PHOTOS["beauty-wellness"][5], after_photo: PHOTOS["beauty-wellness"][0], caption: "Long-grown-out single process → hand-painted balayage with face-framing money pieces." },
    ],
  },
  "professional-services": {
    faq: [
      { question: "Do you offer free consultations?",                                            answer: "Yes — a 30-minute initial consultation is complimentary. We use it to understand your goals and quote the engagement in writing before any work begins." },
      { question: "How is your billing structured?",                                             answer: "Most estate-planning matters are flat-fee. You'll receive a signed engagement letter that lists exactly what's included and what's not before any work starts." },
      { question: "Do I need to come to the office, or can we work remotely?",                   answer: "Both. We meet in our Congress Avenue office for signing, but most planning conversations can happen by phone or video for clients who prefer it." },
      { question: "What happens after I sign my documents?",                                     answer: "We help you fund the trust (re-titling accounts and deeds), file what needs filing, and provide an annual review check-in for three years at no additional charge." },
      { question: "Do you handle out-of-state property?",                                         answer: "We coordinate with local counsel in the relevant state. Your Texas plan can absolutely cover real estate outside of Texas, with the right ancillary documents." },
    ],
  },
  "food-beverage": {
    menu_highlights: [
      { name: "Migas",                  description: "Eggs scrambled with tortilla chips, jack cheese, pico de gallo, and roasted tomato salsa. The reason people stand in line.", price: "$4.25", photo: PHOTOS["food-beverage"][0] },
      { name: "Al Pastor",              description: "Marinated pork sliced off the trompo, served with grilled pineapple, cilantro, white onion, and salsa verde.",          price: "$3.75", photo: PHOTOS["food-beverage"][1] },
      { name: "Barbacoa de Res",        description: "Slow-cooked beef cheek, served simply with chopped onion and cilantro. Sundays and weekends only.",                    price: "$4.50", photo: PHOTOS["food-beverage"][2] },
      { name: "Chorizo & Egg",          description: "House-made chorizo, scrambled egg, on a fresh corn or flour tortilla. Add cheese, papas, or beans.",                 price: "$3.75", photo: PHOTOS["food-beverage"][3] },
      { name: "Bean & Cheese",          description: "Refried pinto beans, sharp cheddar, on a hand-pressed flour tortilla. The honest one.",                              price: "$3.00", photo: PHOTOS["food-beverage"][4] },
    ],
  },
  "real-estate": {
    team_members: [
      { name: "Sara Lindgren",   role: "Principal Broker", photo: PHOTOS["real-estate"][0], bio_short: "Tarrytown native. 14 years in central Austin sales. Top 1% Austin Board of Realtors." },
      { name: "Diego Vasquez",   role: "Senior Agent",     photo: PHOTOS["real-estate"][1], bio_short: "Buyer specialist for Travis Heights, Bouldin, and East side neighborhoods. Bilingual." },
      { name: "Hana Tanaka",     role: "Listing Agent",    photo: PHOTOS["real-estate"][2], bio_short: "Pre-list staging + photography lead. Sold 38 homes last year, average 7 days on market." },
    ],
    faq: [
      { question: "How is your commission structured?",                                          answer: "Standard 5–6% total for full-service listings, negotiable based on price point and timeline. Buyer-side is paid by the seller in most transactions." },
      { question: "Do you handle homes outside central Austin?",                                  answer: "We focus on the central and west neighborhoods we know cold. For homes outside that footprint, we refer to a small network of agents we trust." },
      { question: "How long do most homes stay on the market?",                                  answer: "Our recent listings average 9 days from list to under contract. Pre-list staging and photography typically add 14 days to the prep timeline." },
      { question: "What does the pre-list process look like?",                                   answer: "30 days before list: declutter consultation, staging, professional photography, copywriting, and pricing strategy. We hand off a turnkey listing." },
    ],
  },
  "fitness-pet": {
    team_members: [
      { name: "Coach Tasha B.",  role: "Head Coach (L3)",  photo: PHOTOS["fitness-pet"][0], bio_short: "Eight years coaching. Olympic-lifting focus. Don't bring excuses — bring chalk." },
      { name: "Coach Dev S.",    role: "Lead Coach (L2)",  photo: PHOTOS["fitness-pet"][1], bio_short: "Endurance + gymnastics specialist. Former CrossFit Games regional athlete." },
      { name: "Coach Maria P.",  role: "Coach + Nutrition", photo: PHOTOS["fitness-pet"][2], bio_short: "Beginner on-ramp, nutrition coaching, and the reason everyone leaves smiling." },
    ],
    before_after: [
      { before_photo: PHOTOS["fitness-pet"][3], after_photo: PHOTOS["fitness-pet"][4], caption: "Eight months, four classes a week, basic protein habits. Forty-pound deadlift PR added in the process." },
      { before_photo: PHOTOS["fitness-pet"][5], after_photo: PHOTOS["fitness-pet"][0], caption: "Post-pregnancy return-to-training over twelve months. Strict pull-up + thirty unbroken double-unders by month nine." },
    ],
  },
};

function buildSiteData(cfg, derivedPalette) {
  const extra = EXTRA_CONTENT[cfg.slug] ?? {};
  // Use the derived palette (extracted from the business's actual hero photo)
  // when available; fall back to the per-config palette only if extraction
  // failed. This proves the production pipeline — each business gets a
  // palette from ITS photos, not a niche-stereotype palette we pre-baked.
  const palette = derivedPalette ?? cfg.palette;
  return {
    business_name: cfg.business_name,
    phone: cfg.phone,
    email: cfg.email,
    address: cfg.address,
    brand_color: palette.primary,
    category: cfg.category,
    niche: cfg.slug,
    rating: cfg.rating,
    review_count: cfg.review_count,
    palette: palette,
    variants: {
      hero: cfg.hero,
      services: cfg.slug === "professional-services" ? "minimal-list"
              : ["beauty-wellness","food-beverage","home-goods-vintage","real-estate"].includes(cfg.slug) ? "photo-cards"
              : "bento-grid",
      reviews: cfg.review_count >= 50 ? "masonry-grid" : "marquee",
      trust: ["professional-services","home-services","landscaping-construction"].includes(cfg.slug) ? "badge-grid" : "animated-strip",
      service_area: "styled-list",
      cta: ["home-services","landscaping-construction","real-estate"].includes(cfg.slug) ? "full-section" : "sticky-bar",
    },
    theme: cfg.theme,
    // Niche-specific section composition + visual signature — the two
    // dimensions that break the "every site feels the same" feeling.
    sections: SECTION_RECIPES[cfg.slug] ?? SECTION_RECIPES["home-services"],
    niche_signature: SIGNATURES[cfg.slug] ?? SIGNATURES["home-services"],
    photos: PHOTOS[cfg.slug],
    reviews: cfg.reviews,
    service_areas: cfg.service_areas,
    business_hours: cfg.business_hours,
    copy: cfg.copy,
    is_service_area_only: false,
    // Optional content for niche-specific sections — each section
    // component no-ops when its content is absent.
    ...(extra.team_members   ? { team_members:   extra.team_members   } : {}),
    ...(extra.before_after   ? { before_after:   extra.before_after   } : {}),
    ...(extra.faq            ? { faq:            extra.faq            } : {}),
    ...(extra.menu_highlights ? { menu_highlights: extra.menu_highlights } : {}),
  };
}

// ── Run ───────────────────────────────────────────────────────────────────
console.log(`[batch] Building ${NICHES.length} niche samples → ${OUTPUT_ROOT}`);
mkdirSync(OUTPUT_ROOT, { recursive: true });

const Vibrant = await loadVibrant();
if (Vibrant) console.log("[batch] node-vibrant loaded — palettes will be extracted from each business's hero photo");
else        console.log("[batch] node-vibrant NOT available — palettes will use per-config fallbacks");

const originalData = readFileSync(DATA_JSON, "utf-8");
const summary = [];

try {
  for (const cfg of NICHES) {
    const startedAt = Date.now();
    console.log(`\n[batch] ── ${cfg.slug} (${cfg.business_name}) — hero: ${cfg.hero}`);

    // 1. Extract brand color from THIS business's actual hero photo.
    //    Same logic stage-2-enrich uses in production — proving every real
    //    lead gets a palette specific to its own photos, not a niche-stereotype
    //    palette we hand-picked.
    const heroPhoto = PHOTOS[cfg.slug][0];
    const seedHex = await extractBrandColor(Vibrant, heroPhoto, cfg.palette.primary);
    const derivedPalette = derivePalette(seedHex);
    console.log(`[batch]   palette seed: ${seedHex}  →  primary ${derivedPalette.primary} + accent ${derivedPalette.accent}`);

    // 2. Build the site data with the derived palette.
    const payload = buildSiteData(cfg, derivedPalette);
    writeFileSync(DATA_JSON, JSON.stringify(payload, null, 2), "utf-8");
    // BUILD_BASE_PATH tells Astro to prefix asset URLs with the niche slug
    // so this build can be served at localhost/<slug>/ without CSS/JS 404s.
    // (Production builds leave it unset → assets at root, no prefix.)
    execSync("npm run build", {
      cwd: TEMPLATE_DIR,
      stdio: "inherit",
      env: { ...process.env, BUILD_BASE_PATH: `/${cfg.slug}` },
    });

    const outDir = join(OUTPUT_ROOT, cfg.slug);
    rmSync(outDir, { recursive: true, force: true });
    cpSync(DIST_DIR, outDir, { recursive: true });
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    summary.push({ ...cfg, elapsed, extracted_palette: derivedPalette, seed_hex: seedHex });
    console.log(`[batch] ${cfg.slug} ✓ (${elapsed}s)`);
  }
} finally {
  // Restore original data.json regardless of success/failure
  writeFileSync(DATA_JSON, originalData, "utf-8");
  console.log("\n[batch] Restored original data.json");
}

// Write QA index page that links to all 8 samples
const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Niche Sample QA — premium-trades</title>
  <style>
    body { font: 15px/1.5 system-ui, -apple-system, sans-serif; max-width: 920px; margin: 40px auto; padding: 0 24px; color: #1a1f26; background: #faf7f1; }
    h1 { font: 600 28px/1.1 Georgia, serif; margin: 0 0 8px; letter-spacing: -0.02em; }
    p { color: #6b7280; margin: 0 0 32px; }
    ul { list-style: none; padding: 0; display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
    @media (max-width: 640px) { ul { grid-template-columns: 1fr; } }
    li a { display: block; padding: 16px 20px; background: #fff; border: 1px solid rgba(26,31,38,0.08); border-radius: 8px; text-decoration: none; color: inherit; transition: transform 0.15s, box-shadow 0.15s; }
    li a:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(26,31,38,0.08); }
    .slug { font: 600 11px/1 system-ui; text-transform: uppercase; letter-spacing: 0.15em; color: #1F4E79; }
    .biz { font: 600 18px/1.2 Georgia, serif; margin: 6px 0 4px; }
    .meta { font-size: 12px; color: #6b7280; }
    .hero { display: inline-block; margin-top: 6px; padding: 2px 8px; background: #f4f7fa; border-radius: 3px; font-size: 11px; font-weight: 600; color: #1F4E79; }
    .palette { display: flex; gap: 4px; margin-top: 10px; }
    .swatch { width: 28px; height: 18px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.08); }
    .seed { font: 600 10px/1 ui-monospace, monospace; color: #6b7280; margin-left: 6px; align-self: center; }
  </style>
</head>
<body>
  <h1>Niche Sample QA</h1>
  <p>One built site per niche, all using the same premium-trades template. Compare hero variants, palette, photo coherence, and copy fit.</p>
  <ul>
    ${summary.map((s) => {
      const p = s.extracted_palette ?? s.palette;
      return `
    <li>
      <a href="./${s.slug}/index.html">
        <div class="slug">${s.slug}</div>
        <div class="biz">${s.business_name}</div>
        <div class="meta">${s.category} · ${s.rating}★ · ${s.review_count} reviews · built in ${s.elapsed}s</div>
        <span class="hero">hero: ${s.hero}</span>
        <div class="palette">
          <span class="swatch" style="background:${p.primary}" title="primary ${p.primary}"></span>
          <span class="swatch" style="background:${p.accent}" title="accent ${p.accent}"></span>
          <span class="swatch" style="background:${p.surface_alt}" title="surface_alt ${p.surface_alt}"></span>
          <span class="swatch" style="background:${p.neutral_900}" title="neutral_900 ${p.neutral_900}"></span>
          ${s.seed_hex ? `<span class="seed">seed ${s.seed_hex}</span>` : ""}
        </div>
      </a>
    </li>`;
    }).join("")}
  </ul>
</body>
</html>`;
writeFileSync(join(OUTPUT_ROOT, "index.html"), indexHtml, "utf-8");

console.log(`\n[batch] ✓ ${summary.length}/${NICHES.length} samples built`);
console.log(`[batch] Open: ${join(OUTPUT_ROOT, "index.html")}`);
