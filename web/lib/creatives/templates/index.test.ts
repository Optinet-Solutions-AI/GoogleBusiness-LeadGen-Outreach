/**
 * index.test.ts — unit tests for the post-template registry, renderer and input schemas.
 *
 * Inputs:  renderTemplateHtml / TEMPLATES / templateInputSchema
 * Outputs: vitest assertions
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { ASPECTS, TEMPLATE_KEYS, type CreativeInputs } from "../types";
import { TEMPLATES, renderTemplateHtml, templateInputSchema, type RenderContext } from "./index";
import { fontFaceCss } from "./fonts";

const inputs: CreativeInputs = {
  headline: "<b>x</b> Spring tune-up",
  subhead: "Sub & more",
  cta_text: "Book now",
  cta_kind: "book",
  body: "Great service",
  slides: [
    { headline: "S1", subhead: "s1" },
    { headline: "S2", subhead: "s2" },
  ],
  colors: { primary: "#C50711", accent: "#F5B400", background: "#FFFFFF", text: "#111111" },
  logo_asset_id: null,
  photo_asset_ids: ["p1"],
  background_asset_id: null,
  background_prompt: null,
};
const fonts = { heading: "serif", body: "sans" } as const;

describe("renderTemplateHtml", () => {
  for (const key of TEMPLATE_KEYS) {
    for (const aspect of ASPECTS) {
      it(`${key} ${aspect}`, () => {
        const html = renderTemplateHtml(key, inputs, {
          aspect, slide: null, logoUrl: "https://x.test/l.png?a=1&b=\"2", photoUrls: ["https://x.test/p.jpg"],
          backgroundUrl: null, fonts,
        });
        expect(html).toContain(`data-aspect="${aspect}"`);
        expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(html).not.toContain("<b>x</b>");
        expect(html).toContain(fontFaceCss());
        expect(html).toContain("dataset.fit");
        expect(html).not.toContain("{{");
      });
    }
  }
  it("renders a carousel slide and marker", () => {
    const html = renderTemplateHtml("offer", inputs, {
      aspect: "1:1", slide: 1, logoUrl: null, photoUrls: [], backgroundUrl: null, fonts,
    });
    expect(html).toContain(">S2<");
    expect(html).toContain("2 / 2");
    expect(html).not.toContain("{{");
  });
});

describe("TEMPLATES", () => {
  it("metadata", () => {
    expect(TEMPLATES["tip-quote"].defaultBackground).toBe(true);
    expect(TEMPLATES["product-hero"].defaultBackground).toBe(false);
    expect(TEMPLATES.review.supportsCarousel).toBe(false);
    expect(TEMPLATES["product-hero"].needsPhoto).toBe(true);
  });
});

describe("templateInputSchema", () => {
  it("product-hero rejects empty photos", () => {
    expect(templateInputSchema("product-hero").safeParse({ ...inputs, photo_asset_ids: [] }).success).toBe(false);
    expect(templateInputSchema("product-hero").safeParse(inputs).success).toBe(true);
  });
  it("review requires body and subhead", () => {
    expect(templateInputSchema("review").safeParse({ ...inputs, body: "" }).success).toBe(false);
    expect(templateInputSchema("review").safeParse(inputs).success).toBe(true);
  });
  it("requires headline", () => {
    expect(templateInputSchema("tip-quote").safeParse({ ...inputs, headline: "" }).success).toBe(false);
  });
});

describe("fit coverage and empty chrome", () => {
  const ctx: RenderContext = { aspect: "1:1", slide: null, logoUrl: null, photoUrls: [], backgroundUrl: null, fonts };
  it("cta is a .fit element and the script checks .fit", () => {
    const html = renderTemplateHtml("offer", inputs, ctx);
    expect(html).toContain('querySelectorAll(".fit")');
    expect(html).toContain('class="cta fit ');
  });
  it("hides cta and subhead chrome when empty", () => {
    const html = renderTemplateHtml("tip-quote", { ...inputs, cta_text: "", subhead: "" }, ctx);
    expect(html).toContain('class="cta fit hidden"');
    expect(html).toContain('class="sub fit hidden"');
    expect(html).not.toContain("{{");
  });
});
