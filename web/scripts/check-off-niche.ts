/**
 * check-off-niche.ts — Assertion-based verification for qualifies()'s
 * category_off_niche soft flag (bucket-comparison logic).
 *
 * Run with: npx tsx scripts/check-off-niche.ts   (from web/)
 * Exits non-zero on any failure.
 */
import { qualifies } from "../lib/filters";

interface Case {
  niche: string;
  category: string | null;
  business_name: string;
  expectOffNiche: boolean;
  note?: string;
}

// Every case has rating/reviews/phone so it passes the hard filters and we can
// read category_off_niche.
const CASES: Case[] = [
  { niche: "roofer", category: "Roofing contractor", business_name: "Aspen Roofing", expectOffNiche: false, note: "the reported bug: roofer → stem 'roof' ⇄ roofing" },
  { niche: "plumber", category: "Plumbing service", business_name: "Joe's Plumbing", expectOffNiche: false, note: "plumber → 'plumb' ⇄ plumbing" },
  { niche: "landscaper", category: "Landscaping company", business_name: "Green Thumb", expectOffNiche: false, note: "landscaper → 'landscap' ⇄ landscaping" },
  { niche: "personal trainer", category: "Physical fitness program", business_name: "Jasa Personal Trainer", expectOffNiche: false, note: "trainer → 'train' hits the name; must NOT flag" },
  { niche: "roofer", category: "Pizza restaurant", business_name: "Mario's", expectOffNiche: true, note: "genuinely off-niche → still flags" },
  { niche: "plumber", category: "Auto repair shop", business_name: "Big Tex Mechanic", expectOffNiche: true, note: "genuinely off-niche → still flags" },
];

let failed = 0;
for (const c of CASES) {
  const res = qualifies(
    { rating: 4.5, review_count: 20, phone: "555-1212", category: c.category, business_name: c.business_name },
    c.niche,
  );
  const got = res.category_off_niche === true;
  if (got !== c.expectOffNiche) {
    failed++;
    console.error(
      `FAIL  niche=${JSON.stringify(c.niche)} category=${JSON.stringify(c.category)}` +
        `\n      expectOffNiche=${c.expectOffNiche}  got=${got}` +
        (c.note ? `\n      note=${c.note}` : ""),
    );
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${CASES.length} cases failed.`);
  process.exit(1);
}
console.log(`OK — ${CASES.length}/${CASES.length} off-niche cases pass.`);
