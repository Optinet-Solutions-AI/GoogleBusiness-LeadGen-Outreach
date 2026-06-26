/**
 * pms-today.ts — Populate TODAY's PMS Daily Report. Registers each of today's real accomplishments
 *                as a completed-today task (created then MOVED into Done, which logs the completion
 *                event the report reads), and adds genuine current pending tasks. All assigned to me.
 *                Idempotent by title — re-running won't duplicate or re-fire completion events.
 *
 * Inputs:  env + auth from scripts/pms-client.ts (repo-root .env); reads project columns + viewer id
 * Outputs: POST /api/projects/:id/tasks + PATCH /api/tasks/:id/move (into Done) for completed work
 * Used by: operator, ad-hoc — `npx tsx web/scripts/pms-today.ts`
 */

import { BASE, authedGet } from "./pms-client";

const projectId = process.env.PMS_PROJECT_ID || "";

type Task = { id: string; title: string; columnId?: string };
type Column = { id: string; name: string; tasks?: Task[] };
type Project = { viewer?: { id: string }; columns?: Column[] };

// Today's real accomplishments → marked completed today (moved into Done, which
// logs the completion event the Daily Report reads). Older days' items are NOT
// listed here — they already have their completion events from prior runs;
// re-listing them would only no-op (they're already in Done).
const COMPLETED: Array<{ title: string; description: string }> = [
  { title: "Made our outreach send like a real person (anti-spam pacing)", description: "Shipped + deployed. Emails now go out spaced apart, never two back-to-back from the same inbox, and on an unpredictable rhythm instead of a fixed every-few-minutes pattern. The first email of a campaign is also staggered across the send window. Together this keeps our sending accounts from being flagged as spam." },
  { title: "Three pickable email styles per prospect type, with live preview", description: "Shipped + deployed. Each prospect type (no website / weak website / good website) now has three ready-made email styles: friendly, direct, and curiosity-led. You pick one per campaign and see a live preview of exactly what will send. Copy can also be hand-edited per campaign, and every email auto-translates to the prospect's language. Also produced a PDF of all templates in 7 languages for team-leader approval." },
  { title: "Safe campaign launching (test first) + pause / resume / delete", description: "Shipped + deployed. Clicking Launch now sends you a test email first and asks 'all good?' before anything reaches a real prospect. Campaigns can be paused, resumed, or deleted from the list, and you can open any lead to see the full message history. The page also shows exactly when each email is scheduled to send (per campaign and per lead)." },
  { title: "Rebuilt the Inbox to work like Gmail + automatic replies", description: "Shipped + deployed. Search, filters (unread, starred, needs reply, done, do-not-contact), star, archive, snooze, labels, compose, and keyboard shortcuts. Replies from prospects now arrive automatically every few minutes instead of needing a manual refresh." },
  { title: "Bulk demo-site building", description: "Shipped + deployed. You can now select many leads and build all their demo websites at once instead of one at a time. This was the main thing blocking website campaigns from running at real volume." },
  { title: "Spreadsheet-style tables across the app", description: "Shipped + deployed. Every table keeps its column headers visible while you scroll and lets you drag columns into any order, like a spreadsheet." },
];

// Genuine current to-dos.
const PENDING: Array<{ title: string; description: string; priority: string }> = [
  { title: "Set up billing (Stripe) to charge closed customers", priority: "HIGH", description: "The only missing money step: when a customer says yes, charge the setup fee and start the monthly hosting subscription. Starting this now." },
  { title: "Launch the first real campaign (92 AI-services leads)", priority: "HIGH", description: "92 businesses that already have a good website are ready for the AI-services pitch (no demo needed). Send a test, then launch." },
  { title: "Email warm-up ongoing", priority: "MEDIUM", description: "The 9 sending mailboxes are mid-warmup, so daily volume is still ramping over the next 1-2 weeks. Keep volume within caps while it ramps." },
  { title: "Connect SMS key (Mobivate) — unlock ~125 phone-reachable leads", priority: "MEDIUM", description: "SMS sending is built but dormant. Connect the Mobivate key to enable the SMS channel (~125 phone-reachable leads)." },
];

const norm = (t: string): string => t.replace(/^\s*\d{4}-\d{2}-\d{2}[^—]*—\s*/u, "").trim();

async function main(): Promise<void> {
  if (!projectId) throw new Error("No project id. Set PMS_PROJECT_ID in .env.");

  const { headers, body: project } = await authedGet<Project>(`${BASE}/api/projects/${projectId}`);
  const meId = project.viewer?.id;
  if (!meId) throw new Error("Could not determine current user id (viewer).");

  const cols = project.columns ?? [];
  const pick = (re: RegExp) => cols.find((c) => re.test(c.name));
  const todo = pick(/^to ?do$/i) ?? cols[0];
  const done = pick(/^done$/i) ?? cols[cols.length - 1];

  const byTitle = new Map<string, Task>();
  for (const c of cols) for (const t of c.tasks ?? []) byTitle.set(norm(t.title), { ...t, columnId: t.columnId ?? c.id });

  const moveToDone = async (taskId: string) => {
    const r = await fetch(`${BASE}/api/tasks/${taskId}/move`, { method: "PATCH", headers, body: JSON.stringify({ columnId: done.id, position: 0 }) });
    if (!r.ok) throw new Error(`move→Done failed ${r.status}: ${await r.text()}`);
  };

  // 1. Completed-today: ensure each exists and sits in Done via a move (which logs the completion event).
  let completed = 0;
  for (const item of COMPLETED) {
    const found = byTitle.get(item.title);
    if (found && found.columnId === done.id) {
      console.log(`already done: ${item.title}`);
      continue;
    }
    let taskId = found?.id;
    if (!taskId) {
      const r = await fetch(`${BASE}/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: item.title, columnId: todo.id, description: item.description, priority: "MEDIUM", assigneeIds: [meId] }),
      });
      if (!r.ok) {
        console.error(`POST FAIL ${r.status}: ${item.title} — ${await r.text()}`);
        continue;
      }
      taskId = ((await r.json()) as { id: string }).id;
    }
    await moveToDone(taskId);
    completed++;
    console.log(`completed-today: ${item.title}`);
  }

  // 2. Pending: create in To Do, assigned to me. Idempotent by title.
  let pending = 0;
  for (const p of PENDING) {
    if (byTitle.has(p.title)) {
      console.log(`skip (exists): ${p.title}`);
      continue;
    }
    const r = await fetch(`${BASE}/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: p.title, columnId: todo.id, description: p.description, priority: p.priority, assigneeIds: [meId] }),
    });
    if (!r.ok) {
      console.error(`POST FAIL ${r.status}: ${p.title} — ${await r.text()}`);
      continue;
    }
    pending++;
    console.log(`pending: ${p.title}`);
  }

  console.log(`\nDone. completed-today=${completed} pending-created=${pending}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
