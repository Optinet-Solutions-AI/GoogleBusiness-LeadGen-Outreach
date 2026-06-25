import { describe, it, expect } from "vitest";
import { buildCampaignConfig } from "./lead-campaign-config";

const tzFor = (cc: string | null) => (cc === "au" ? "Australia/Sydney" : "UTC");
const DEFAULT = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 20 };

describe("buildCampaignConfig", () => {
  it("uses the campaign pool + window + country", () => {
    const cfg = buildCampaignConfig({
      campaign: { sender_emails: ["a@x.com", "b@x.com"], sender_email: "a@x.com", call_days: [1, 3], call_start_hour: 10, call_end_hour: 16, country_code: "au" },
      leadCountryCode: "us",
      tzFor, allMailboxes: ["z@x.com"], defaultWindow: DEFAULT,
    });
    expect(cfg.senderPool).toEqual(["a@x.com", "b@x.com"]);
    expect(cfg.window).toEqual({ tz: "Australia/Sydney", days: [1, 3], startHour: 10, endHour: 16 });
    expect(cfg.countryCode).toBe("au");
  });

  it("falls back to single sender_email when sender_emails is null", () => {
    const cfg = buildCampaignConfig({
      campaign: { sender_emails: null, sender_email: "solo@x.com", call_days: null, call_start_hour: null, call_end_hour: null, country_code: null },
      leadCountryCode: "au", tzFor, allMailboxes: ["z@x.com"], defaultWindow: DEFAULT,
    });
    expect(cfg.senderPool).toEqual(["solo@x.com"]);
    expect(cfg.window).toEqual({ tz: "Australia/Sydney", days: DEFAULT.days, startHour: 9, endHour: 20 });
  });

  it("no campaign -> all mailboxes, lead country, default window", () => {
    const cfg = buildCampaignConfig({
      campaign: null, leadCountryCode: "au", tzFor, allMailboxes: ["z@x.com", "y@x.com"], defaultWindow: DEFAULT,
    });
    expect(cfg.senderPool).toEqual(["z@x.com", "y@x.com"]);
    expect(cfg.countryCode).toBe("au");
    expect(cfg.window.tz).toBe("Australia/Sydney");
  });
});
