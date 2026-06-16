/**
 * verify-html-templates.ts — smoke-test the 5 single-file HTML templates.
 *
 * Inputs:  templates/{trades,dental,chiropractic,restaurant,auto}-site/
 * Outputs: renders each to .tmp/verify-html/<slug>/dist/index.html and asserts
 *          identity/contact swapped + no known {{token}} left behind; also
 *          checks templateForNiche() routes the focus niches correctly.
 * Used by: manual verification (npx tsx scripts/verify-html-templates.ts).
 */

import path from "node:path";
import fs from "node:fs/promises";
import { renderHtmlTemplate } from "../lib/pipeline/html-template-render";
import { templateForNiche, isWebsiteBuildable } from "../lib/data/niches";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const TEMPLATES = path.join(REPO_ROOT, "templates");
const OUT = path.join(REPO_ROOT, ".tmp", "verify-html");

const SLUGS = ["trades-site", "dental-site", "chiropractic-site", "restaurant-site", "auto-site"];
const KNOWN_TOKENS = ["business_name", "phone", "phone_tel", "address", "email", "accent", "reviews", "hours"];

const lead = {
  business_name: "Joe's Garage & Co",
  phone: "(512) 555-0142",
  address: "118 Lavaca St, Austin, TX",
  email: "joe@joesgarage.com",
  brand_color: null,
  reviews: [
    { text: "Fixed my brakes the same day and the bill matched the quote exactly. Honest crew.", rating: 5, author: "Sam P." },
    { text: "Called in a panic about a leak; they walked me through it and showed up within the hour.", rating: 5, author: "Marta L." },
  ],
  business_hours: { "Mon–Fri": "8am–6pm", Saturday: "9am–2pm", Sunday: "Closed" },
};

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.log("  ✗ " + msg);
  }
}

async function main() {
  for (const slug of SLUGS) {
    console.log(`\n[${slug}]`);
    const outDir = path.join(OUT, slug);
    const distDir = await renderHtmlTemplate(lead, path.join(TEMPLATES, slug), outDir);
    const html = await fs.readFile(path.join(distDir, "index.html"), "utf-8");

    check(html.includes("Joe's Garage"), "business name present");
    check(html.includes("(512) 555-0142"), "display phone present");
    check(html.includes("tel:5125550142"), "tel: digits present");
    for (const t of KNOWN_TOKENS) {
      check(!html.includes(`{{${t}}}`), `no leftover {{${t}}}`);
    }
    // The 4 static templates personalize reviews; auto keeps its own.
    if (slug !== "auto-site") {
      check(html.includes("Fixed my brakes"), "real review injected");
      check(html.includes("Sam P."), "real reviewer injected");
    }
    if (failures === 0 || true) console.log(`  bytes: ${html.length}`);
  }

  console.log("\n[templateForNiche routing]");
  const cases: Array<[string, string]> = [
    ["dentist", "dental-site"],
    ["family dental practice", "dental-site"],
    ["chiropractor", "chiropractic-site"],
    ["italian restaurant", "restaurant-site"],
    ["coffee shop & cafe", "restaurant-site"],
    ["auto repair", "auto-site"],
    ["mobile car detailing", "auto-site"],
    ["plumber", "trades-site"],
    ["hvac", "trades-site"],
    ["handyman", "trades-site"],
    ["general contractor", "trades-site"],
    ["roofer", "premium-trades"],
    ["landscaping", "premium-trades"],
    ["salon", "premium-trades"],
    ["lawyer", "premium-trades"],
    ["dog walker", "premium-trades"],
  ];
  for (const [niche, want] of cases) {
    const got = templateForNiche(niche);
    check(got === want, `templateForNiche("${niche}") = ${got} (want ${want})`);
  }

  console.log("\n[isWebsiteBuildable gate]");
  for (const slug of SLUGS) check(isWebsiteBuildable(slug), `${slug} is buildable`);
  for (const slug of ["premium-trades", "trades", "", null, undefined]) {
    check(!isWebsiteBuildable(slug as string), `${String(slug)} is NOT buildable`);
  }

  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
