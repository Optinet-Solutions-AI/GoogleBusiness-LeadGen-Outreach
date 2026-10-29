/**
 * stage-5-buy-inventory.test.ts — the liquidation-lead cold email.
 *
 * Inputs:  a sample WARN lead
 * Outputs: vitest assertions (short, no links, names the place, has an opt-out)
 * Used by: npm test
 */
import { describe, expect, it } from "vitest";
import { composeBuyInventoryEmail, renderOutreachEmail } from "./stage-5-email";

const lead = { id: "x", business_name: "Lombard Street Facility", email: "a@b.com", primary_offer: "buy_inventory", address: "Portland, OR" };

describe("buy-inventory email", () => {
  it("is plain, short, linkless, names the place and offers an opt-out", () => {
    const { subject, html } = composeBuyInventoryEmail(lead);
    const words = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    expect(subject).toContain("Lombard Street Facility");
    expect(html).toContain("Portland, OR");
    expect(html).not.toMatch(/https?:|<a |<img/);
    expect(html).toMatch(/reply "no"/);
    expect(words).toBeLessThanOrEqual(120);
  });
  it("is what renderOutreachEmail picks for buy_inventory, and not for other offers", () => {
    expect(renderOutreachEmail(lead).html).toContain("inventory");
    expect(renderOutreachEmail({ ...lead, primary_offer: "build_website" }).html).not.toContain("inventory");
  });
});
