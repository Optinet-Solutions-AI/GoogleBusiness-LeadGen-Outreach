/**
 * dm-message.ts — the default assisted-DM message for a social lead.
 *
 * Pure + client-safe. Shared by AssistedDmPanel (lead page / inbox) and the
 * Social worklist row so the wording stays consistent everywhere.
 */

export type DmOffer = "build_website" | "improve_website" | "voice_agent" | null;

export function renderDmMessage(businessName: string, offer?: DmOffer): string {
  const name = businessName.trim();
  const idea =
    offer === "improve_website"
      ? "had a quick idea to freshen up your website"
      : offer === "voice_agent"
        ? "had a quick idea that could help you catch more enquiries"
        : "had a quick idea for getting you a simple website";
  return `Hi! I came across ${name} and ${idea}. Mind if I share a quick example — no cost, no commitment?`;
}
