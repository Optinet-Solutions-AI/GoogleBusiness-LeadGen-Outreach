/**
 * (dashboard)/brain/page.tsx — the Brain: give it a job in plain words, approve its plan, and it sends by itself.
 *
 * Inputs:  the jobs (lib/brain/jobs.ts listJobs; says so when migration 074 isn't applied)
 * Outputs: the page shell around BrainClient (command box, jobs, the selected job)
 * Used by: route "/brain". Workflow: workflows/run_brain_job.md
 */
import { PageHeader } from "@/components/ui/PageHeader";
import { BrainClient, type JobListItem } from "@/components/brain/BrainClient";
import { MISSING_074, listJobs } from "@/lib/brain/jobs";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  const { jobs, missing } = await listJobs().catch(() => ({ jobs: [], missing: false }));
  return (
    <div>
      <PageHeader
        eyebrow="Outreach"
        title="Brain"
        subtitle="Tell it what you want in plain words. It asks a few settings, finds the leads, decides who to contact and how, shows you one plan to approve, then emails, sends contact forms and queues AI calls by itself."
      />
      {missing ? (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-ink">{MISSING_074}</p>
      ) : (
        <BrainClient initialJobs={jobs as unknown as JobListItem[]} />
      )}
    </div>
  );
}
