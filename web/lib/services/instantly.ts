/**
 * instantly.ts — Instantly.ai cold-email API client.
 *
 * Inputs:  campaign_id, email, first_name, business_name, demo_url
 * Outputs: provider lead_id (for webhook reconciliation)
 * Used by: lib/pipeline/stage-5-outreach.ts
 *
 * Docs: https://developer.instantly.ai
 */

import { env } from "../config";
import { getLogger } from "../logger";
import { retry } from "../retry";

const log = getLogger("instantly");
const BASE_URL = "https://api.instantly.ai/api/v2";

function headers(): Record<string, string> {
  if (!env.INSTANTLY_API_KEY) throw new Error("INSTANTLY_API_KEY missing");
  return {
    Authorization: `Bearer ${env.INSTANTLY_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function addLeadToCampaign(opts: {
  campaign_id: string;
  email: string;
  first_name: string;
  business_name: string;
  demo_url: string;
  custom?: Record<string, unknown>;
}): Promise<string> {
  const payload = {
    campaign: opts.campaign_id,
    email: opts.email,
    first_name: opts.first_name,
    company_name: opts.business_name,
    personalization: opts.demo_url,
    custom_variables: opts.custom ?? { demo_url: opts.demo_url },
  };

  const resp = await retry(
    () =>
      fetch(`${BASE_URL}/leads`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      }),
    { maxAttempts: 3 },
  );
  if (!resp.ok) throw new Error(`instantly.error ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { id?: string; lead_id?: string };
  const id = data.id ?? data.lead_id ?? "";
  log.info({ email: opts.email, id }, "instantly.lead.added");
  return id;
}
