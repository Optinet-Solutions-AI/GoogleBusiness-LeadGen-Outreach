/**
 * scripts/voizo-check.ts — Voizo pre-flight: status check, and (only when asked) ONE test call.
 *
 * Inputs:  VOIZO_API_KEY (repo-root .env); flags below
 * Outputs: prints status / the call result; writes NOTHING to our DB
 * Used by: the operator, for the "Before the first live call" checklist (workflows/call_leads_voizo.md)
 *
 *   npx tsx scripts/voizo-check.ts                              → GET /status only (no call)
 *   npx tsx scripts/voizo-check.ts --dial=+15125550100 --name=Chris  → dials THAT number, polls to done
 *   npx tsx scripts/voizo-check.ts --poll=<callId> [--transcript]    → fetch one call
 *
 * --dial rings a real phone and uses one of today's 100 calls. Use your own number.
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const { getStatus, placeCall, getCall, isVoizoConfigured } = await import("@/lib/services/voizo");
  if (!isVoizoConfigured()) {
    console.error("VOIZO_API_KEY is not set in the repo-root .env");
    process.exit(2);
  }

  const status = await getStatus();
  if (!status.ok) {
    console.error(`status refused: ${status.status} ${status.code}: ${status.error}`);
    process.exit(1);
  }
  console.log("status:", JSON.stringify(status.data, null, 2));
  console.log(status.data.shadow === true ? "✓ shadow: true" : "✗ shadow is NOT true. Do not dial.");
  if (status.data.shadow !== true) process.exit(1);

  const pollId = arg("poll");
  if (pollId) {
    const r = await getCall(pollId, { transcript: flag("transcript") });
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const phone = arg("dial");
  if (!phone) return; // status-only

  const dial = await placeCall({ phone, name: arg("name"), clientRef: "voizo-check" });
  if (!dial.ok) {
    console.log(`dial refused: ${dial.status} ${dial.code}: ${dial.error}`);
    return;
  }
  console.log(`dialing… callId=${dial.data.callId} remainingToday=${dial.data.remainingToday}`);

  const started = Date.now();
  while (Date.now() - started < 15 * 60_000) {
    await new Promise((r) => setTimeout(r, 15_000));
    const r = await getCall(dial.data.callId);
    if (!r.ok) {
      console.log(`poll: ${r.code}`);
      continue;
    }
    console.log(`poll: status=${r.data.status} done=${r.data.done}`);
    if (r.data.done) {
      const full = await getCall(dial.data.callId, { transcript: true });
      console.log(JSON.stringify(full, null, 2));
      return;
    }
  }
  console.log("gave up after 15 minutes. Mark it unknown.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
