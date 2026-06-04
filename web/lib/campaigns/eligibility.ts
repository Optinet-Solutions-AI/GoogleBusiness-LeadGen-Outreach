/**
 * eligibility.ts — Channel definitions + the "which leads apply for this channel" filter.
 *
 * A lead is classified at scrape time (email / phone / website_kind), so a campaign's channel
 * decides which leads are reachable: email→has email, sms/voice→has phone, dm→has a social page.
 * Used by: app/api/campaigns/route.ts (snapshot) + app/api/leads/count/route.ts (live count).
 */

export type Channel = "voice_agent" | "sms" | "dm" | "email";

export const CHANNELS: { value: Channel; label: string; hint: string }[] = [
  { value: "email", label: "Email", hint: "leads with an email" },
  { value: "sms", label: "SMS", hint: "leads with a phone" },
  { value: "dm", label: "DM (social)", hint: "leads with a Facebook/Instagram page" },
  { value: "voice_agent", label: "Voice agent", hint: "leads with a phone" },
];

export const ALL_CHANNELS: Channel[] = ["voice_agent", "sms", "dm", "email"];

/** website_kind values that count as a DM-able social page. */
export const SOCIAL_KINDS = [
  "facebook",
  "instagram",
  "twitter",
  "linkedin",
  "tiktok",
  "pinterest",
  "youtube",
  "other_social",
];

/**
 * Apply the channel-eligibility filter to a Supabase leads query builder.
 * Builder types from supabase-js are deeply generic; we treat it loosely and return it.
 */
export function applyChannelEligibility<Q>(query: Q, channel: Channel): Q {
  const q = query as any;
  switch (channel) {
    case "email":
      return q.not("email", "is", null);
    case "sms":
    case "voice_agent":
      return q.not("phone", "is", null);
    case "dm":
      return q.in("website_kind", SOCIAL_KINDS);
    default:
      return q;
  }
}
