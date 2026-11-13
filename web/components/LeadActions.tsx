"use client";

/**
 * LeadActions.tsx — right-rail action panel on the Lead detail page.
 * Owns: build website (+ the in-progress spinner), skip, meeting buttons, and the close-out buttons.
 * Rebuild / Improve form / Hand over were removed from the lead page (meeting 13 Nov 2026): the APIs stay.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, CheckCircle2, ArrowRight, Hammer, XCircle, Bot } from "lucide-react";
import { buildSurfaceFor } from "@/lib/lead-offer";
import type { CallSegment } from "@/lib/segment";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/cx";

interface Lead {
  id: string;
  email: string | null;
  stage: string;
  demo_url: string | null;
  custom_domain: string | null;
  handover_mode: string | null;
  /** ISO timestamp set by /api/leads/[id]/regenerate. Drives refresh-safe spinner. */
  rebuild_started_at: string | null;
  /** Per-lead design override slug (e.g. "ironworks-auto"). Null = use batch/registry default. */
  template_variant: string | null;
}

/** Spinner shows for up to this long after the rebuild was triggered. After that
 *  the UI assumes the job crashed silently and falls out of the rebuilding state.
 *  A full enrich → generate → deploy → screenshot on Cloud Run regularly runs
 *  several minutes, so this must comfortably exceed a real build (the job itself
 *  allows up to 1800s). The server clears rebuild_started_at in a `finally`, so
 *  this is only the ceiling for a hard-crashed job that never ran its finally. */
const REBUILD_STALE_MS = 20 * 60 * 1000;

export function LeadActions({
  lead,
  buildable,
  segment,
  designs = [],
  nicheSlug,
}: {
  lead: Lead;
  buildable: boolean;
  segment: CallSegment;
  designs?: { slug: string; name: string }[];
  /** Focus template slug (e.g. "auto-site") — for the design preview links. */
  nicheSlug?: string | null;
}) {
  const router = useRouter();
  const [selectedDesign, setSelectedDesign] = useState<string | null>(
    lead.template_variant ?? designs[0]?.slug ?? null,
  );

  const [meetingNotes, setMeetingNotes] = useState("");
  const [building, setBuilding] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [skipping, setSkipping] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    const res = await fetchJson(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.success) toast.error(res.error);
    return res;
  }

  async function postMeeting(status: "booked" | "done") {
    const res = await fetchJson(`/api/leads/${lead.id}/meeting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes: meetingNotes || undefined }),
    });
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success(`Meeting marked ${status}.`);
    setMeetingNotes("");
    router.refresh();
  }


  async function setStage(stage: string) {
    if (!confirm(`Mark as ${stage}?`)) return;
    const res = await patch({ stage });
    if (res.success) toast.success(`Marked ${stage.replaceAll("_", " ")}.`);
    router.refresh();
  }

  async function buildSite() {
    if (building) return;
    if (!confirm("Build the website for this lead? This calls the Gemini API + creates a Cloudflare Pages project. ~30s.")) return;
    setBuilding(true);
    const triggered = await fetchJson(`/api/leads/${lead.id}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_variant: selectedDesign }),
    });
    if (!triggered.success) {
      toast.error(triggered.error);
      setBuilding(false);
      return;
    }
    toast.info("Build started — enrich → generate → deploy (~30–90s).");
    // Use the shared polling loop so the rebuild_started_at flag is
    // cleared on completion (same path as rebuild). previousDemoUrl is
    // null on a first-time build — any non-null demo_url breaks the loop.
    await pollRebuildUntilDone(lead.demo_url);
  }

  /**
   * Poll the lead until the pipeline finishes, then refresh the UI. The build
   * itself runs server-side (Cloud Run job / local fire-and-forget) and is NOT
   * affected by navigation — this loop only mirrors that state into the UI.
   *
   * The SERVER owns `rebuild_started_at`: the Cloud Run job clears it in a
   * `finally` (see cloud-run-job.ts runTracked / regenerate). So this loop must
   * NEVER clear the flag itself — doing so on a premature timeout is exactly
   * what made a build "disappear" when the operator navigated away. We simply
   * stop polling on completion (demo_url changed / last_error set / server
   * cleared the flag) or when we hit the cap; the flag lifecycle is server-side.
   *
   * Cap is generous (~15 min at 3s) so a long-but-live Cloud Run build keeps
   * being tracked; the loop normally exits earlier when the server clears the
   * flag. `cancelledRef` stops a detached loop from touching state after the
   * component unmounts (navigation), preventing stray refreshes.
   */
  const pollRefcount = useRef(0);
  const cancelledRef = useRef(false);
  async function pollRebuildUntilDone(previousDemoUrl: string | null) {
    pollRefcount.current += 1;
    const myCall = pollRefcount.current;
    for (let i = 0; i < 300; i++) {
      // Bail if a newer poll started (e.g. user clicked rebuild again) or the
      // component unmounted.
      if (pollRefcount.current !== myCall || cancelledRef.current) return;
      await new Promise((r) => setTimeout(r, 3000));
      if (pollRefcount.current !== myCall || cancelledRef.current) return;
      const j = await fetchJson<{
        demo_url: string | null;
        last_error: string | null;
        rebuild_started_at: string | null;
      }>(`/api/leads/${lead.id}`);
      if (!j.success) continue;
      if (j.data.last_error) break;
      if (j.data.demo_url && j.data.demo_url !== previousDemoUrl) break;
      // Server cleared the flag in its `finally` → the pipeline finished.
      if (!j.data.rebuild_started_at) break;
    }
    // NOTE: we deliberately do NOT PATCH rebuild_started_at here. On a timeout
    // the job may still be running server-side; clearing the flag would hide a
    // live build. The server clears it when the job's finally runs.
    if (pollRefcount.current === myCall && !cancelledRef.current) {
      setRebuilding(false);
      setBuilding(false);
      router.refresh();
    }
  }

  // On mount: if the server says a long-running pipeline (build OR rebuild)
  // is in progress and the timestamp is fresh — within the stale window —
  // restore the spinner state and resume polling. This is what makes the
  // spinner survive a page refresh / nav-away / nav-back.
  //
  // We pick between `building` and `rebuilding` based on whether a demo_url
  // already exists. Build is the first-time pipeline (no demo_url yet);
  // rebuild is a re-run on an existing site. Both share rebuild_started_at
  // because canBuild and canRebuild are mutually exclusive by lead.stage.
  useEffect(() => {
    cancelledRef.current = false;
    if (lead.rebuild_started_at) {
      const startedMs = new Date(lead.rebuild_started_at).getTime();
      if (!Number.isNaN(startedMs) && Date.now() - startedMs <= REBUILD_STALE_MS) {
        if (lead.demo_url) {
          setRebuilding(true);
        } else {
          setBuilding(true);
        }
        pollRebuildUntilDone(lead.demo_url);
      }
    }
    // Stop any in-flight poll from mutating state / refreshing after unmount.
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function skipLead() {
    if (skipping) return;
    if (!confirm("Skip this lead? Marks it as 'dead' so the dashboard hides it.")) return;
    setSkipping(true);
    const res = await patch({ stage: "dead" });
    setSkipping(false);
    if (res.success) toast.success("Lead skipped.");
    router.refresh();
  }

  const stageCanBuild = ["scraped", "enriched", "generated"].includes(lead.stage);
  const canSkip = !["closed_won", "handed_over", "dead"].includes(lead.stage);
  // Offer strategy: a healthy existing site (has_website) is NEVER offered a
  // website — pitch AI services instead. The Build/Improve/Rebuild surface only
  // shows for no_website / old_website in a focus niche; off-niche leads run
  // outreach only. Single source of truth: buildSurfaceFor.
  const surface = buildSurfaceFor({ segment, buildable });
  const canBuild = stageCanBuild && surface === "build";
  // A healthy existing site: Build stays available, but the automated outreach pitches AI services —
  // say so next to the button rather than hiding it.
  const showAiServices = segment === "has_website" && canSkip;
  const showOffNiche = stageCanBuild && surface === "off_niche";

  return (
    <aside className="space-y-6">
      {/* Build / AI services / Skip — operator review gate */}
      {(canBuild || showAiServices || showOffNiche || canSkip) && (
        <Section label={canBuild ? "Build website" : showAiServices ? "AI services" : "Triage"}>
          {showAiServices && (
            <div className="mb-3 rounded-lg bg-action-soft border border-action/30 p-3">
              <div className="flex items-center gap-1.5 text-action font-semibold text-[13px] mb-1">
                <Bot className="h-4 w-4" strokeWidth={2.25} /> Outreach pitches AI services here
              </div>
              <p className="text-[12px] text-ink-muted">
                This business already has a healthy website, so the automated emails offer AI services
                (an AI receptionist / booking assistant) rather than a site. You can still build a demo
                below if you want one. Change the segment on the left if the site is actually weak or missing.
              </p>
            </div>
          )}
          {canBuild && (
            <>
              <p className="text-[12px] text-ink-muted mb-3">
                Lead currently at <span className="font-mono text-ink-muted">{lead.stage}</span>.
                Click to run enrich → generate → deploy. Sends nothing — that&apos;s a separate step.
              </p>
              {designs.length > 0 && (
                <div className="mb-3">
                  <label className="block text-[10px] font-bold text-ink-muted uppercase tracking-[0.14em] font-mono mb-1">
                    Design variant
                  </label>
                  <select
                    value={selectedDesign ?? ""}
                    onChange={(e) => setSelectedDesign(e.target.value || null)}
                    className="w-full h-9 px-3 text-body-sm border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white"
                  >
                    {designs.map((d) => (
                      <option key={d.slug} value={d.slug}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {nicheSlug && selectedDesign && (
                    <a
                      href={`/template-previews/${nicheSlug}/${selectedDesign}.html`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-action hover:underline"
                    >
                      Preview &quot;{designs.find((d) => d.slug === selectedDesign)?.name}&quot;
                      <ArrowRight className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={buildSite}
                loading={building}
              >
                {!building && <Hammer strokeWidth={2.5} />}
                {building ? "Building… (~30–90s)" : "Build website"}
              </Button>
            </>
          )}
          {showOffNiche && segment === "liquidation" && (
            <p className="text-[12px] text-ink-muted mb-3">
              Closure-signal lead: no demo website is built for these. Use Email (inventory offer) instead.
            </p>
          )}
          {showOffNiche && segment === "exhibitor" && (
            <p className="text-[12px] text-ink-muted mb-3">
              Conference exhibitor: no demo website is built for these. Use Email (booth offer) instead.
            </p>
          )}
          {canBuild && !buildable && (
            <p className="text-[12px] text-ink-muted mb-3">
              No dedicated design for this niche yet — the general template is used. Dedicated designs:
              Trades, Dental, Chiropractic, Restaurants &amp; Auto Shops.
            </p>
          )}
          {canSkip && (
            <Button
              variant={canBuild || showAiServices ? "soft" : "soft-danger"}
              className={cx("w-full", (canBuild || showAiServices || showOffNiche) && "mt-2")}
              onClick={skipLead}
              loading={skipping}
            >
              {!skipping && <XCircle strokeWidth={2.5} />}
              {skipping ? "Skipping…" : "Skip this lead"}
            </Button>
          )}
        </Section>
      )}

      {/* Meeting */}
      <Section label="Meeting">
        <textarea
          value={meetingNotes}
          onChange={(e) => setMeetingNotes(e.target.value)}
          rows={2}
          placeholder="Optional notes (call time, agreed scope…)"
          className="w-full p-2.5 text-body-sm border border-rule rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none resize-y"
        />
        <div className="flex gap-2 mt-2">
          <Button variant="soft-action" className="flex-1" onClick={() => postMeeting("booked")}>
            <Calendar /> Mark booked
          </Button>
          <Button variant="soft-positive" className="flex-1" onClick={() => postMeeting("done")}>
            <CheckCircle2 /> Mark done
          </Button>
        </div>
      </Section>

      {rebuilding && (
        <Section label="Website">
          <p className="text-[12px] text-ink-muted">Rebuilding the demo site… (~60–90s)</p>
        </Section>
      )}

      {/* Danger zone */}
      <details className="group bg-surface-alt border border-rule rounded-lg">
        <summary className="cursor-pointer list-none p-4 flex items-center justify-between text-label-caps text-ink-muted uppercase tracking-wider">
          Close out
          <ArrowRight className="h-4 w-4 transition-transform group-open:rotate-90" />
        </summary>
        <div className="px-4 pb-4 space-y-2">
          <Button variant="positive" className="w-full" onClick={() => setStage("closed_won")}>
            Closed — won
          </Button>
          <Button variant="soft-danger" className="w-full" onClick={() => setStage("closed_lost")}>
            Closed — lost
          </Button>
          <Button variant="soft" className="w-full" onClick={() => setStage("dead")}>
            Mark dead
          </Button>
        </div>
      </details>

    </aside>
  );
}

function Section({
  label,
  children,
  id,
}: {
  label: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="bg-white border border-rule rounded-lg p-4 scroll-mt-20">
      <p className="text-label-caps text-ink-muted uppercase tracking-wider mb-3">{label}</p>
      {children}
    </section>
  );
}
