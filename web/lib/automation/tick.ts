/**
 * automation/tick.ts — one run of the automation (Cloud Run MODE=automation, Cloud Scheduler "automation-tick" every
 * 15 minutes; workflow run_automation.md).
 *
 * Inputs:  the time
 * Outputs: starts due batch emails, moves the running Brain jobs forward (lib/brain/runner.ts), sends up to 2
 *          automatic contact forms, runs the day's scheduled batch; a summary
 * Used by: scripts/cloud-run-job.ts (MODE=automation)
 *
 * Each part runs on its own: one failing never stops the others. A run that creates the day's scheduled batch (it takes
 * minutes) skips the contact forms; the next run does them.
 */
import "@/lib/server-guard";
import { getLogger } from "@/lib/logger";
import { startDueAutoEmails } from "./auto-email";
import { runAutoContactForms } from "./auto-contact-forms";
import { runScheduledBatch } from "./schedules";
import { runBrainJobs } from "@/lib/brain/runner";

const log = getLogger("automation-tick");

export async function runAutomationTick(now: number = Date.now()): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = {};
  const part = async (name: string, fn: () => Promise<unknown>) => {
    try {
      summary[name] = await fn();
    } catch (err) {
      summary[name] = { error: String(err).slice(0, 300) };
      log.error({ part: name, err: String(err) }, "automation.part_failed");
    }
  };
  await part("autoEmail", () => startDueAutoEmails(now));
  await part("scheduledBatch", () => runScheduledBatch(now));
  // A run that just did a scheduled batch (minutes) leaves the contact forms to the next run: well within the 30 minutes.
  const ranBatch = (summary.scheduledBatch as { ran?: boolean } | undefined)?.ran === true;
  // Brain jobs first (the operator approved those plans): their due contact forms and calls, stops and wins.
  if (!ranBatch) await part("brainJobs", () => runBrainJobs(now));
  if (!ranBatch) await part("contactForms", () => runAutoContactForms(now));
  log.info(summary, "automation.tick_done");
  return summary;
}
