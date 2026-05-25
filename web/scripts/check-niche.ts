/**
 * check-niche.ts — Assertion-based verification for classifyNiche.
 *
 * Run with: npx tsx scripts/check-niche.ts (from web/)
 * Exits non-zero on any failure so it can be wired into CI later.
 */
import { classifyNiche, type NicheKey } from "../lib/niche";

interface Case {
  category: string | null;
  business_name: string;
  expected: NicheKey;
  note?: string;
}

const CASES: Case[] = [
  // Real-world failing cases from the 2026-05-25 audit
  { category: "consultant", business_name: "Mimi and Me Estate Sales", expected: "vintage-antiques-thrift", note: "estate sale company" },
  { category: "home_goods_store", business_name: "The Little Things | Balloon Garlands & Event Styling Hamilton", expected: "event-services", note: "balloon styling miscategorized by Google" },

  // Each of the 20 buckets — one canonical example
  { category: "Plumber", business_name: "Joe's Plumbing", expected: "home-services-trades" },
  { category: null, business_name: "Aqua Restoration Services", expected: "cleaning-restoration" },
  { category: "Roofing contractor", business_name: "Aspen Roofing", expected: "roofing-exterior" },
  { category: "Landscaper", business_name: "Green Thumb Landscaping", expected: "landscaping-outdoor" },
  { category: "General contractor", business_name: "Texas Remodel Co", expected: "construction-remodel" },
  { category: "Auto repair shop", business_name: "Big Tex Mechanic", expected: "automotive" },
  { category: "Hair salon", business_name: "Bluebonnet Salon", expected: "beauty-hair-nails" },
  { category: "Massage therapist", business_name: "Calm Wellness Spa", expected: "spa-massage-wellness" },
  { category: "Gym", business_name: "Iron Pulse Fitness", expected: "fitness-gyms" },
  { category: "Veterinarian", business_name: "Riverside Pet Hospital", expected: "pet-services" },
  { category: "Restaurant", business_name: "Lone Star Diner", expected: "food-restaurants" },
  { category: "Cafe", business_name: "Sunrise Coffee Bakery", expected: "food-cafe-bakery" },
  { category: "Caterer", business_name: "Texas Catering Co", expected: "food-catering-events" },
  { category: "Lawyer", business_name: "Smith Law Firm", expected: "professional-legal-financial" },
  { category: "Marketing agency", business_name: "Pearl Creative Studio", expected: "professional-creative-tech" },
  { category: "Real estate agency", business_name: "Hill Country Realtors", expected: "real-estate" },
  { category: "Antique store", business_name: "Granny's Antiques", expected: "vintage-antiques-thrift" },
  { category: "Furniture store", business_name: "Modern Living Furniture", expected: "home-decor-retail" },
  { category: "Florist", business_name: "Petal & Stem Floral", expected: "event-services" },
  { category: "Jewelry store", business_name: "Diamond Boutique", expected: "boutique-gift-retail" },

  // Edge cases
  { category: null, business_name: "", expected: "home-services-trades", note: "empty → default" },
  { category: "home_goods_store", business_name: "Aunt Mae's Antique Mart", expected: "vintage-antiques-thrift", note: "name beats category" },
];

let failed = 0;
for (const c of CASES) {
  const got = classifyNiche(c.category, c.business_name);
  if (got !== c.expected) {
    failed++;
    console.error(
      `FAIL  category=${JSON.stringify(c.category)} name=${JSON.stringify(c.business_name)}` +
        `\n      expected=${c.expected}  got=${got}` +
        (c.note ? `\n      note=${c.note}` : ""),
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${CASES.length} cases failed.`);
  process.exit(1);
}
console.log(`OK — ${CASES.length}/${CASES.length} niche cases pass.`);
