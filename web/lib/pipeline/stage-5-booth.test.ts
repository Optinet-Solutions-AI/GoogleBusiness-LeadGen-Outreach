/**
 * stage-5-booth.test.ts — the exhibitor-lead cold email (booth-building offer).
 *
 * Inputs:  a sample exhibitor lead with signal_meta
 * Outputs: vitest assertions (short, no links, names the show + stand, has an opt-out)
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { composeBoothEmail, renderOutreachEmail } from "./stage-5-email";

const lead = { id: "x", business_name: "Acme Gaming", email: "a@b.com", primary_offer: "booth_build", signal_meta: { event_name: "SiGMA Europe 2026", booth: "A12" } };

describe("booth email", () => {
  it("is plain, short, linkless, names the show and stand, offers an opt-out", () => {
    const { subject, html } = composeBoothEmail(lead);
    const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    expect(subject).toContain("SiGMA Europe 2026");
    expect(html).toContain("Acme Gaming");
    expect(html).toContain("SiGMA Europe 2026 (stand A12)");
    expect(html).toMatch(/exhibition stands across Europe/);
    expect(html).not.toMatch(/https?:|<a |<img/);
    expect(html).toMatch(/reply "no"/);
    expect(words).toBeLessThan(120);
  });
  it("works without event details and is picked by the offer", () => {
    const { subject, html } = composeBoothEmail({ id: "y", business_name: "Beta", email: null, primary_offer: "booth_build" });
    expect(subject).toMatch(/stand|booth|Stand/);
    expect(html).toContain("at a recent trade show");
    expect(renderOutreachEmail(lead).html).toContain("exhibition stands");
  });
});
