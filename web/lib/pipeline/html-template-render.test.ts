/**
 * html-template-render.test.ts — lock the token-swap contract:
 *  - scalar tokens (name/phone/address) are replaced everywhere
 *  - tel: href gets digits-only; display keeps the lead's formatting
 *  - real reviews replace the {{reviews}} block; defaults fill in when absent
 *  - {{hours}} renders from business_hours, else defaults
 *  - text fields are HTML-escaped; no {{token}} survives the render
 *  - a template WITHOUT {{reviews}}/{{hours}} keeps its designed content
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  renderHtmlTemplate,
  fillTokens,
  telDigits,
  escapeHtml,
} from "./html-template-render";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "htmltpl-"));
  const tpl = await fs.mkdir(path.join(dir, "tpl", "partials"), { recursive: true });
  void tpl;
  const tplDir = path.join(dir, "tpl");
  await fs.writeFile(
    path.join(tplDir, "template.html"),
    `<title>{{business_name}}</title>
<a href="tel:{{phone_tel}}">{{phone}}</a>
<address>{{address}}</address>
<style>:root{--accent:{{accent}};}</style>
<section class="reviews">{{reviews}}</section>
<div class="hours">{{hours}}</div>`,
  );
  await fs.writeFile(
    path.join(tplDir, "partials", "review.html"),
    `<article><div class="stars">{{stars}}</div><p>{{review_text}}</p><cite>{{review_author}} — {{review_meta}}</cite></article>`,
  );
  await fs.writeFile(
    path.join(tplDir, "partials", "hours-row.html"),
    `<div class="row"><span>{{hours_label}}</span><span>{{hours_value}}</span></div>`,
  );
  await fs.writeFile(
    path.join(tplDir, "defaults.json"),
    JSON.stringify({
      accent: "#bb4d2b",
      phone: "(555) 000-0000",
      phone_tel: "5550000000",
      address: "1 Default St",
      reviews: [{ stars: "★★★★★", text: "Default review text here.", author: "Sample C.", meta: "Google" }],
      hours: [{ label: "Monday", value: "Closed" }],
    }),
  );
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function render(lead: Parameters<typeof renderHtmlTemplate>[0]): Promise<string> {
  const out = path.join(dir, "out", lead.business_name);
  const distDir = await renderHtmlTemplate(lead, path.join(dir, "tpl"), out);
  return fs.readFile(path.join(distDir, "index.html"), "utf-8");
}

describe("fillTokens / telDigits / escapeHtml", () => {
  it("replaces known tokens and leaves unknown ones intact", () => {
    expect(fillTokens("a {{x}} b {{y}}", { x: "1" })).toBe("a 1 b {{y}}");
  });
  it("strips formatting for tel: but keeps a leading +", () => {
    expect(telDigits("(555) 567-8901")).toBe("5555678901");
    expect(telDigits("+1 555-234-5678")).toBe("+15552345678");
  });
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml("Joe & Sons <Auto>")).toBe("Joe &amp; Sons &lt;Auto&gt;");
  });
});

describe("renderHtmlTemplate", () => {
  it("swaps identity + contact and leaves no tokens behind", async () => {
    const html = await render({
      business_name: "Joe's Garage",
      phone: "(555) 567-8901",
      address: "42 Iron St",
      brand_color: "#123456",
      reviews: [
        { text: "Best mechanics in town, fixed my brakes same day no problem.", rating: 5, author: "Marcus T." },
      ],
      business_hours: { "Mon–Fri": "8am–6pm", Sat: "9am–1pm" },
    });
    expect(html).toContain("<title>Joe's Garage</title>"); // apostrophe not escaped by our escaper
    expect(html).toContain('href="tel:5555678901"');
    expect(html).toContain("42 Iron St");
    expect(html).toContain("--accent:#123456;");
    expect(html).toContain("fixed my brakes");
    expect(html).toContain("Marcus T.");
    expect(html).toContain("Mon–Fri");
    expect(html).toContain("8am–6pm");
    expect(html).not.toMatch(/\{\{\w+\}\}/); // nothing left unresolved
  });

  it("falls back to template defaults when lead fields are missing", async () => {
    const html = await render({ business_name: "Bare Co" });
    expect(html).toContain("(555) 000-0000"); // default phone
    expect(html).toContain("1 Default St"); // default address
    expect(html).toContain("--accent:#bb4d2b;"); // default accent
    expect(html).toContain("Default review text here."); // default review
    expect(html).toContain("Closed"); // default hours
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe("JSON tokens for React-bundle designs", () => {
  it("emits a JSON array for {{reviews_json}} and {{hours_json}}", async () => {
    const tplDir = path.join(dir, "tpljson", "partials");
    await fs.mkdir(tplDir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "tpljson", "template.html"),
      `<script>const R={{reviews_json}};const H={{hours_json}};const N="{{business_name}}";</script>`,
    );
    await fs.writeFile(
      path.join(dir, "tpljson", "defaults.json"),
      JSON.stringify({
        accent: "#000",
        reviews: [{ stars: "★★★★★", text: "Default.", author: "A", meta: "Google" }],
        hours: [{ label: "Mon", value: "Closed" }],
      }),
    );
    const out = path.join(dir, "outjson");
    const distDir = await renderHtmlTemplate(
      {
        business_name: "Bundle Co",
        reviews: [{ text: "Real review long enough to pass the filter.", rating: 5, author: "Z" }],
        business_hours: { Mon: "9-5" },
      },
      path.join(dir, "tpljson"),
      out,
    );
    const html = await fs.readFile(path.join(distDir, "index.html"), "utf-8");
    expect(html).toContain('const N="Bundle Co"');
    expect(html).toContain("Real review long enough");        // real review serialized
    expect(html).toContain('"label":"Mon","value":"9-5"');    // real hours serialized
    expect(html).not.toMatch(/\{\{\w+\}\}/);                   // no token survives
    expect(() => JSON.parse(html.match(/const R=(\[.*?\]);/s)![1])).not.toThrow();
  });
});
