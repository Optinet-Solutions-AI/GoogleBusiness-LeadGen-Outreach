/**
 * lead-campaign-config.ts — Resolve the send config (mailbox pool, window, tz,
 *                           country) the scheduler should use for a lead. Pure.
 *
 * Inputs:  the lead's most-recent active campaign row (or null), the lead's
 *          country, a country->tz resolver, all active mailboxes, default window
 * Outputs: { senderPool, window, countryCode }
 * Used by: lib/pipeline/sequence-scheduler.ts
 *
 * A lead in a campaign uses that campaign's mailbox pool + window + country; a
 * lead in no campaign (enrolled directly from the lead page) falls back to all
 * active mailboxes, its own country, and the default window.
 */

import type { SendWindow } from "./send-window";

export interface CampaignConfig {
  senderPool: string[];
  window: SendWindow;
  countryCode: string | null;
}

interface CampaignRow {
  sender_emails: string[] | null;
  sender_email: string | null;
  call_days: number[] | null;
  call_start_hour: number | null;
  call_end_hour: number | null;
  country_code: string | null;
}

export function buildCampaignConfig(input: {
  campaign: CampaignRow | null;
  leadCountryCode: string | null;
  tzFor: (cc: string | null) => string;
  allMailboxes: string[];
  defaultWindow: { days: number[]; startHour: number; endHour: number };
}): CampaignConfig {
  const { campaign, leadCountryCode, tzFor, allMailboxes, defaultWindow } = input;

  const senderPool =
    campaign?.sender_emails?.length
      ? campaign.sender_emails
      : campaign?.sender_email
        ? [campaign.sender_email]
        : allMailboxes;

  const countryCode = campaign?.country_code ?? leadCountryCode ?? null;

  const window: SendWindow = {
    tz: tzFor(countryCode),
    days: campaign?.call_days?.length ? campaign.call_days : defaultWindow.days,
    startHour: campaign?.call_start_hour ?? defaultWindow.startHour,
    endHour: campaign?.call_end_hour ?? defaultWindow.endHour,
  };

  return { senderPool, window, countryCode };
}
