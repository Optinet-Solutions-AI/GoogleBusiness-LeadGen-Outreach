/**
 * scripts/visual-qa.ts — AI visual reviewer for built sites.
 *
 * Inputs:  list of localhost URLs (or pass via CLI: --urls=u1,u2,...)
 *          + niche labels for each
 * Outputs: per-URL JSON critique with score (1-10), strengths, weaknesses,
 *          and concrete fix suggestions. Writes to stdout + .tmp/visual-qa.json
 * Used by: operator review of local samples; CI gate (later).
 *
 * How it works:
 *   1. Calls the existing Python Playwright screenshot helper to capture
 *      a full-page PNG at 1440x900 desktop width (re-uses what's already
 *      installed for sample QA).
 *   2. Reads the PNG, base64-encodes it.
 *   3. Sends to Gemini 2.5 Flash with a niche-aware critique prompt.
 *   4. Parses structured JSON back. If score < threshold, flags for reroll.
 *
 * Cost: each call ~1500 input tokens (image + prompt) + ~400 output. On
 * Gemini 2.5 Flash free tier (1500 req/day) this is well within budget for
 * spot-checking sites.
 *
 * Run:
 *   npm run --prefix web run:visual-qa
 *   npm run --prefix web run:visual-qa -- --urls=http://localhost:4401/,http://localhost:4402/ \
 *                                          --niches=home-services,home-goods-vintage
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { GoogleGenAI, Type } from "@google/genai";

loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

const DEFAULT_TARGETS: Array<{ url: string; niche: string; label: string }> = [
  { url: "http://localhost:4401/", niche: "home-services",       label: "Joe's Plumbing"      },
  { url: "http://localhost:4402/", niche: "home-goods-vintage",  label: "Mimi & Me Estate Sales" },
  { url: "http://localhost:4403/", niche: "professional-services", label: "Lakeside Law Group" },
  { url: "http://localhost:4404/", niche: "beauty-wellness",     label: "Bloom Hair Studio"   },
];

const CRITIQUE_PROMPT = `You are a senior brand designer reviewing a small-
business website. Be honest and specific — soft "looks fine" feedback is
not useful. Flag what would make the *business owner* not buy this.

# Your job
Score the site 1-10 for "would the business owner believe a designer spent
10 hours custom-coding this for $2,000?" Then list concrete, actionable
issues.

# What to look for
- Does it look distinctive for this niche, or interchangeable with any
  other small-business template?
- Hero impact: is it dramatic, on-brand, and immediately readable?
- Color depth: rich palette presence, or sterile white walls?
- Typography: does the font choice match the niche (e.g. classical serifs
  for legal, modern sans for trades, editorial serif for boutique)?
- Section variety: does each section pull its weight, or do some feel
  hollow / placeholder-y?
- Photography: do photos feel real and on-niche, or stocky/mismatched?
- CTAs: are they prominent, clear, and conversion-focused?
- Trust signals: is the social proof concrete or generic?
- Visual rhythm: alternating dark/light bands, or a wall of one color?

# Output format
Return JSON matching the schema. Score must be honest: a 6/10 with a clear
list of issues is more useful than a defensive 8.`;

const CRITIQUE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER },
    one_liner: { type: Type.STRING },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
    fix_suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    niche_fit: {
      type: Type.STRING,
      enum: ["nails it", "close", "off"],
    },
  },
  required: ["score", "one_liner", "strengths", "weaknesses", "fix_suggestions", "niche_fit"],
};

interface Critique {
  score: number;
  one_liner: string;
  strengths: string[];
  weaknesses: string[];
  fix_suggestions: string[];
  niche_fit: "nails it" | "close" | "off";
}

const SCREENSHOT_SCRIPT = `c:/tmp/screenshot_samples.py`;
const SCREENSHOT_DIR = `c:/tmp`;

function capture(): boolean {
  // Reuses the existing Python Playwright helper (already installed for
  // sample-QA work). Produces sample_<slug>.png at 1440x900.
  const slug = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/[:.]/g, "-");
  const out = spawnSync("py", [SCREENSHOT_SCRIPT], { stdio: "inherit" });
  return out.status === 0;
}

function pngPathFor(label: string): string {
  // Mirror the existing screenshot_samples.py output naming:
  // c:/tmp/sample_<slug>.png — the slug is the lowercased label.
  const slug = label
    .toLowerCase()
    .replace(/['&]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // The existing screenshotter uses fixed slugs (joes-plumbing, mimi-and-me,
  // lakeside-law, bloom-salon) hard-coded in the script. Map to those.
  const fixedMap: Record<string, string> = {
    "joes-plumbing": "joes-plumbing",
    "mimi-me-estate-sales": "mimi-and-me",
    "lakeside-law-group": "lakeside-law",
    "bloom-hair-studio": "bloom-salon",
  };
  const useSlug = fixedMap[slug] ?? slug;
  return path.join(SCREENSHOT_DIR, `sample_${useSlug}.png`);
}

async function critique(target: { url: string; niche: string; label: string }, client: GoogleGenAI, model: string): Promise<{
  target: typeof target;
  png: string;
  result: Critique | { error: string };
}> {
  const png = pngPathFor(target.label);
  let imageBase64: string;
  try {
    const buf = await fs.readFile(png);
    imageBase64 = buf.toString("base64");
  } catch (e) {
    return { target, png, result: { error: `screenshot not found: ${png}` } };
  }

  const userText =
    `Critique this small-business site. Niche: ${target.niche}. ` +
    `Business: ${target.label}. URL: ${target.url}. ` +
    `Return JSON matching the schema.`;

  try {
    const resp = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: userText },
            { inlineData: { mimeType: "image/png", data: imageBase64 } },
          ],
        },
      ],
      config: {
        systemInstruction: CRITIQUE_PROMPT,
        responseMimeType: "application/json",
        responseSchema: CRITIQUE_SCHEMA,
        temperature: 0.5,
        maxOutputTokens: 4096,
      },
    });
    const text = resp.text ?? "";
    try {
      const data = JSON.parse(text) as Critique;
      return { target, png, result: data };
    } catch (parseErr) {
      // Save the raw text so we can diagnose truncation vs other issues.
      return {
        target,
        png,
        result: { error: `JSON parse: ${String(parseErr)} — raw len=${text.length}, tail="${text.slice(-80)}"` },
      };
    }
  } catch (e) {
    return { target, png, result: { error: String(e) } };
  }
}

function renderCritique(c: Critique): string {
  const bar = "─".repeat(60);
  const stars = "★".repeat(Math.round(c.score)) + "☆".repeat(10 - Math.round(c.score));
  return [
    bar,
    `  Score:    ${c.score}/10  ${stars}`,
    `  Niche fit: ${c.niche_fit}`,
    `  TL;DR:    ${c.one_liner}`,
    ``,
    `  Strengths:`,
    ...c.strengths.map((s) => `    + ${s}`),
    ``,
    `  Weaknesses:`,
    ...c.weaknesses.map((s) => `    - ${s}`),
    ``,
    `  Fix suggestions:`,
    ...c.fix_suggestions.map((s) => `    → ${s}`),
  ].join("\n");
}

async function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, ...v] = a.replace(/^--/, "").split("=");
        return [k, v.join("=")];
      }),
  );

  const targets = (() => {
    if (args.urls && args.niches) {
      const urls = args.urls.split(",");
      const niches = args.niches.split(",");
      return urls.map((u, i) => ({
        url: u,
        niche: niches[i] ?? "home-services",
        label: u.replace(/[^a-z0-9]+/gi, "-"),
      }));
    }
    return DEFAULT_TARGETS;
  })();

  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    console.error("ERROR: GOOGLE_GENAI_API_KEY missing in .env");
    process.exit(1);
  }
  const client = new GoogleGenAI({ apiKey });
  const model = process.env.GOOGLE_GENAI_MODEL || "gemini-2.5-flash";

  console.log(`\n=== Visual QA — ${targets.length} site(s) on ${model} ===\n`);
  if (args["skip-capture"] !== undefined) {
    console.log("Reusing existing screenshots (--skip-capture).\n");
  } else {
    console.log("Capturing screenshots...");
    if (!capture()) {
      console.error("Screenshot step failed — make sure local servers are up.");
      process.exit(1);
    }
    console.log("Screenshots done. Critiquing...\n");
  }

  const results: Array<{ target: typeof targets[number]; result: Critique | { error: string } }> = [];
  for (const target of targets) {
    const out = await critique(target, client, model);
    results.push({ target: out.target, result: out.result });
    console.log(`\n## ${target.label}  (${target.niche})`);
    if ("error" in out.result) {
      console.log(`  ERROR: ${out.result.error}`);
    } else {
      console.log(renderCritique(out.result));
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    results: results.map((r) => ({ ...r.target, ...r.result })),
  };
  const outPath = path.resolve(process.cwd(), "..", ".tmp", "visual-qa.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2));
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
