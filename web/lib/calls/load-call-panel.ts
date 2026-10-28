/**
 * load-call-panel.ts — data for a call campaign's "AI calling" panel.
 *
 * Inputs:  campaign id; Voizo GET /status (no call placed); call_attempts for the campaign
 * Outputs: { configured, status | statusError, counts } — never throws
 * Used by: app/(dashboard)/campaigns/[id]/page.tsx (channel = 'call')
 */

import "@/lib/server-guard";
import { env } from "../config";
import { safeDb } from "../safe-db";
import { getStatus, isVoizoConfigured, type VoizoStatus } from "../services/voizo";

export interface CallCounts {
  placed: number;
  qualified: number;
  declined: number;
  unreached: number;
  badNumber: number;
  inFlight: number;
}

export interface CallPanelData {
  configured: boolean;
  status: VoizoStatus | null;
  statusError: string | null;
  counts: CallCounts;
  maxAttempts: number;
  retryHours: number;
}

const EMPTY: CallCounts = { placed: 0, qualified: 0, declined: 0, unreached: 0, badNumber: 0, inFlight: 0 };

export async function loadCallPanel(campaignId: string): Promise<CallPanelData> {
  const configured = isVoizoConfigured();
  const [statusRes, counts] = await Promise.all([
    configured ? getStatus() : Promise.resolve(null),
    safeDb<CallCounts>(async (db) => {
      const { data } = await db
        .from("call_attempts")
        .select("provider_call_id,processed_at,status,outcome,goal_reached")
        .eq("provider", "voizo")
        .eq("campaign_id", campaignId)
        .limit(5000);
      const c = { ...EMPTY };
      for (const a of (data ?? []) as {
        provider_call_id: string | null;
        processed_at: string | null;
        status: string;
        outcome: string | null;
        goal_reached: boolean | null;
      }[]) {
        if (a.provider_call_id) c.placed += 1;
        if (!a.processed_at) c.inFlight += 1;
        else if (a.goal_reached && a.status !== "voicemail") c.qualified += 1;
        else if (a.outcome === "not_interested") c.declined += 1;
        else if (a.outcome === "wrong_number") c.badNumber += 1;
        else c.unreached += 1;
      }
      return c;
    }, EMPTY),
  ]);

  return {
    configured,
    status: statusRes?.ok ? statusRes.data : null,
    statusError: statusRes && !statusRes.ok ? statusRes.code : null,
    counts,
    maxAttempts: env.VOIZO_MAX_ATTEMPTS,
    retryHours: env.VOIZO_RETRY_HOURS,
  };
}
