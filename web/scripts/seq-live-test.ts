/**
 * scripts/seq-live-test.ts — LIVE end-to-end test of the email-sequence follow-up.
 *
 * Sends REAL email, but ONLY to the operator's own inbox (TEST_EMAIL). Creates a
 * clearly-labelled TEST batch+lead; remove everything with --clean.
 *
 * Commands (run from web/):
 *   npm run run:job is unrelated — use tsx directly:
 *   npx tsx --tsconfig tsconfig.json scripts/seq-live-test.ts --setup
 *   ... --walk     fast-forward through steps 1..4 (one real send each)
 *   ... --reply    simulate a human reply, run a tick → must STOP, 0 sent
 *   ... --bounce   record a hard bounce, run a tick → must STOP, 0 sent
 *   ... --status   print the test lead's state + recent events
 *   ... --clean    delete the TEST batch (cascades lead/messages/events)
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env") });

import { getDb } from "@/lib/db";
import { runSequenceTick } from "@/lib/pipeline/sequence-scheduler";

const TEST_EMAIL = "john@optinetsolutions.com"; // operator's OWN inbox — never a prospect
const BIZ = "TEST — Seq Follow-up (you)";
const CITY = "TEST — seq follow-up";

type Db = ReturnType<typeof getDb>;

async function getTestLead(db: Db) {
  const { data } = await db.from("leads").select("*").eq("business_name", BIZ).limit(1).maybeSingle();
  return data as { id: string; email: string; seq_status: string; seq_step: number } | null;
}

async function clean(db: Db) {
  const { data: batches } = await db.from("batches").select("id").eq("city", CITY);
  const ids = (batches ?? []).map((b: { id: string }) => b.id);
  if (ids.length) {
    await db.from("batches").delete().in("id", ids);
    console.log(`cleaned ${ids.length} TEST batch(es)`);
  } else console.log("nothing to clean");
}

async function setup(db: Db) {
  await clean(db);
  const { data: accts } = await db.from("email_accounts").select("email,status").eq("status", "active");
  console.log("active mailboxes:", accts);
  // Borrow a real demo_url + screenshot_url from a deployed lead so step 2's image
  // and step 3's link are genuine.
  const { data: src } = await db
    .from("leads")
    .select("demo_url,screenshot_url")
    .not("screenshot_url", "is", null)
    .limit(1)
    .maybeSingle();
  const { data: batch } = await db
    .from("batches")
    .insert({ niche: "test", city: CITY, status: "done" })
    .select("id")
    .single();
  const { data: lead, error } = await db
    .from("leads")
    .insert({
      batch_id: batch!.id,
      business_name: BIZ,
      email: TEST_EMAIL,
      country_code: "us",
      source: "manual",
      stage: "deployed",
      demo_url: src?.demo_url ?? "https://example.pages.dev",
      screenshot_url: src?.screenshot_url ?? null,
      call_segment: "no_website",
      verification_status: "valid",
      seq_status: "active",
      seq_step: 0,
      seq_next_step_at: new Date().toISOString(),
    })
    .select("id,email,demo_url,screenshot_url")
    .single();
  if (error) throw new Error(error.message);
  console.log("TEST lead:", lead!.id, "→", lead!.email);
  console.log("demo_url:", lead!.demo_url);
  console.log("screenshot:", lead!.screenshot_url);
}

async function bumpDue(db: Db, id: string) {
  await db
    .from("leads")
    .update({ seq_next_step_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", id)
    .eq("seq_status", "active");
}

async function showState(db: Db, id: string) {
  const { data: l } = await db
    .from("leads")
    .select("seq_status,seq_step,seq_next_step_at,stage,inbox_status,verification_status")
    .eq("id", id)
    .single();
  console.log("  lead:", l);
  const { data: ev } = await db
    .from("outreach_events")
    .select("kind,meta,created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(6);
  console.log(
    "  events:",
    (ev ?? []).map((e: { kind: string; meta: { step?: number } | null }) => `${e.kind}${e.meta?.step ? `(step ${e.meta.step})` : ""}`),
  );
}

async function walk(db: Db) {
  const lead = await getTestLead(db);
  if (!lead) throw new Error("no TEST lead — run --setup first");
  for (let i = 1; i <= 4; i++) {
    await bumpDue(db, lead.id);
    const summary = await runSequenceTick({ limit: 5 });
    console.log(`\n--- tick ${i} ---`, summary);
    await showState(db, lead.id);
    const { data: l } = await db.from("leads").select("seq_status").eq("id", lead.id).single();
    if (l?.seq_status !== "active") {
      console.log(`\nladder ended: seq_status=${l?.seq_status}`);
      break;
    }
    if (summary.held > 0) {
      console.log("\nHELD (cap/pause) — the warmup cap kicked in; stopping the walk.");
      break;
    }
  }
}

async function replyTest(db: Db) {
  const lead = await getTestLead(db);
  if (!lead) throw new Error("no TEST lead");
  // Reactivate, clear any bounce so the STOP is attributable to the reply.
  await db.from("outreach_events").delete().eq("lead_id", lead.id).eq("kind", "email_bounced");
  await db.from("leads").update({ inbox_status: "needs_reply", seq_status: "active", seq_step: 1 }).eq("id", lead.id);
  await bumpDue(db, lead.id);
  const summary = await runSequenceTick({ limit: 5 });
  console.log("reply-stop tick (expect sent:0, stopped:1):", summary);
  await showState(db, lead.id);
}

async function bounceTest(db: Db) {
  const lead = await getTestLead(db);
  if (!lead) throw new Error("no TEST lead");
  // Reactivate, clear reply flag so the STOP is attributable to the bounce.
  await db.from("leads").update({ inbox_status: "open", seq_status: "active", seq_step: 1 }).eq("id", lead.id);
  await db.from("outreach_events").insert({ lead_id: lead.id, kind: "email_bounced", meta: { test: true, bounceKind: "hard" } });
  await bumpDue(db, lead.id);
  const summary = await runSequenceTick({ limit: 5 });
  console.log("bounce-stop tick (expect sent:0, stopped:1):", summary);
  await showState(db, lead.id);
}

async function main() {
  const db = getDb();
  const a = process.argv.slice(2);
  if (a.includes("--clean")) return clean(db);
  if (a.includes("--setup")) return setup(db);
  if (a.includes("--walk")) return walk(db);
  if (a.includes("--reply")) return replyTest(db);
  if (a.includes("--bounce")) return bounceTest(db);
  if (a.includes("--status")) {
    const l = await getTestLead(db);
    if (l) await showState(db, l.id);
    else console.log("no TEST lead");
    return;
  }
  console.log("usage: --setup | --walk | --reply | --bounce | --status | --clean");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
