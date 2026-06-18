// web/lib/pipeline/template-variants.smoke.test.ts
/**
 * template-variants.smoke.test.ts — render every registered design with a
 * sample lead and assert it personalizes cleanly. The gate for Phase-3
 * tokenization: a design passes only when no {{token}} survives, the business
 * name is injected, and defaults.json parses.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderHtmlTemplate } from "./html-template-render";
import { TEMPLATE_DESIGNS } from "../templates/registry";

const TEMPLATES_ROOT = path.resolve(__dirname, "..", "..", "..", "templates");

const SAMPLE = {
  business_name: "Test Business LLC",
  phone: "(555) 123-4567",
  address: "100 Test St, Testville",
  email: "hi@testbiz.example",
  brand_color: "#2266cc",
  reviews: [
    { text: "Genuinely the best service I have received in years, highly recommend.", rating: 5, author: "Sam P." },
  ],
  business_hours: { "Mon–Fri": "9am–5pm", Sat: "10am–2pm" },
};

const cases = Object.entries(TEMPLATE_DESIGNS).flatMap(([niche, designs]) =>
  designs.map((d) => ({ niche, slug: d.slug })),
);

describe("all registered designs render cleanly", () => {
  it.each(cases)("$niche / $slug", async ({ niche, slug }) => {
    const templateDir = path.join(TEMPLATES_ROOT, niche, "variants", slug);
    // defaults.json must parse
    const defaultsRaw = await fs.readFile(path.join(templateDir, "defaults.json"), "utf-8");
    expect(() => JSON.parse(defaultsRaw)).not.toThrow();
    // render
    const out = await fs.mkdtemp(path.join(os.tmpdir(), `tplvar-${slug}-`));
    const distDir = await renderHtmlTemplate(SAMPLE, templateDir, out);
    const html = await fs.readFile(path.join(distDir, "index.html"), "utf-8");
    await fs.rm(out, { recursive: true, force: true });
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("Test Business LLC");
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });
});
