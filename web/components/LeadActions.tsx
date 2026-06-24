"use client";

/**
 * LeadActions.tsx — right-rail action panel on the Lead detail page.
 * Owns: email edit, meeting buttons, ImproveModal toggle, HandoverModal toggle,
 * and the danger-zone close-as-lost / dead buttons.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  MessageSquarePlus,
  Building,
  Pencil,
  ArrowRight,
  Hammer,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { ImproveModal } from "./ImproveModal";
import { HandoverModal } from "./HandoverModal";
import { RebuildConfirmModal } from "./RebuildConfirmModal";
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
 *  the UI assumes the job crashed silently and falls out of the rebuilding state. */
const REBUILD_STALE_MS = 5 * 60 * 1000;

export function LeadActions({
  lead,
  buildable,
  designs = [],
}: {
  lead: Lead;
  buildable: boolean;
  designs?: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState(lead.email ?? "");
  const [editingEmail, setEditingEmail] = useState(!lead.email);
  const [selectedDesign, setSelectedDesign] = useState<string | null>(
    lead.template_variant ?? designs[0]?.slug ?? null,
  );
  const [savingEmail, setSavingEmail] = useState(false);

  const [meetingNotes, setMeetingNotes] = useState("");
  const [improveOpen, setImproveOpen] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
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

  async function saveEmail() {
    if (!email) return;
    setSavingEmail(true);
    const res = await patch({ email });
    setSavingEmail(false);
    setEditingEmail(false);
    if (res.success) toast.success("Email saved.");
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
   * Poll the lead until stage 4 writes a fresh demo_url, or last_error is set,
   * or we time out. Capped at ~150s so a stuck job can't spin forever. Clears
   * the server-side rebuild_started_at flag on completion so other tabs /
   * future page loads stop showing the spinner.
   */
  const pollRefcount = useRef(0);
  async function pollRebuildUntilDone(previousDemoUrl: string | null) {
    pollRefcount.current += 1;
    const myCall = pollRefcount.current;
    for (let i = 0; i < 50; i++) {
      // Bail if a newer poll started (e.g. user clicked rebuild again).
      if (pollRefcount.current !== myCall) return;
      await new Promise((r) => setTimeout(r, 3000));
      const j = await fetchJson<{
        demo_url: string | null;
        last_error: string | null;
        rebuild_started_at: string | null;
      }>(`/api/leads/${lead.id}`);
      if (!j.success) continue;
      if (j.data.last_error) break;
      if (j.data.demo_url && j.data.demo_url !== previousDemoUrl) break;
      // If a different tab already cleared the flag, the rebuild finished.
      if (!j.data.rebuild_started_at) break;
    }
    // Clear the server-side in-progress flag so other tabs / future loads
    // don't keep showing a spinner. Idempotent — safe if already null.
    await fetchJson(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rebuild_started_at: null }),
    });
    if (pollRefcount.current === myCall) {
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
    if (!lead.rebuild_started_at) return;
    const startedMs = new Date(lead.rebuild_started_at).getTime();
    if (Number.isNaN(startedMs)) return;
    if (Date.now() - startedMs > REBUILD_STALE_MS) return;
    if (lead.demo_url) {
      setRebuilding(true);
    } else {
      setBuilding(true);
    }
    pollRebuildUntilDone(lead.demo_url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-component triggers from NextStepPill (top of page). The pill emits
  // window events instead of prop-drilling state up + back down. Listeners
  // open the corresponding modal or focus the email input.
  useEffect(() => {
    const onEditEmail = () => {
      setEditingEmail(true);
      // Wait a tick for the input to render, then focus + scrollIntoView.
      setTimeout(() => {
        emailInputRef.current?.focus();
        emailInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    };
    const onOpenImprove = () => setImproveOpen(true);
    const onOpenHandover = () => setHandoverOpen(true);
    window.addEventListener("lead-actions:edit-email", onEditEmail);
    window.addEventListener("lead-actions:open-improve", onOpenImprove);
    window.addEventListener("lead-actions:open-handover", onOpenHandover);
    return () => {
      window.removeEventListener("lead-actions:edit-email", onEditEmail);
      window.removeEventListener("lead-actions:open-improve", onOpenImprove);
      window.removeEventListener("lead-actions:open-handover", onOpenHandover);
    };
  }, []);

  async function rebuildSite() {
    if (rebuilding) return;
    setRebuilding(true);
    const previousDemoUrl = lead.demo_url;
    const triggered = await fetchJson(`/api/leads/${lead.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Start from 'enrich' so the rebuild also picks up enrichment-stage
      // changes (logo_url, brand_color, etc.). Otherwise template tweaks
      // that depend on enriched fields render as a no-op.
      body: JSON.stringify({ from_stage: "enrich" }),
    });
    if (!triggered.success) {
      toast.error(triggered.error);
      setRebuilding(false);
      return;
    }
    toast.info("Rebuild started — ~60–90s.");
    await pollRebuildUntilDone(previousDemoUrl);
  }

  async function skipLead() {
    if (skipping) return;
    if (!confirm("Skip this lead? Marks it as 'dead' so the dashboard hides it.")) return;
    setSkipping(true);
    const res = await patch({ stage: "dead" });
    setSkipping(false);
    if (res.success) toast.success("Lead skipped.");
    router.refresh();
  }

  const isHandedOver = lead.stage === "handed_over" && !!lead.custom_domain;
  const stageCanBuild = ["scraped", "enriched", "generated"].includes(lead.stage);
  // The website builder runs only for the 5 focus niches — gate the whole
  // build/rebuild/improve surface on it. Off-list leads still scrape, enrich,
  // and run outreach; they just never get a demo site.
  const canBuild = stageCanBuild && buildable;
  const canSkip = !["closed_won", "handed_over", "dead"].includes(lead.stage);
  // Rebuild = regenerate stage 3+4 on the latest template/code without
  // touching `stage`. Available once a site exists (post-Build) and until
  // the lead is closed out / handed off.
  const canRebuild =
    buildable &&
    !!lead.demo_url &&
    !["dead", "closed_won", "closed_lost", "handed_over"].includes(lead.stage);

  return (
    <aside className="space-y-6">
      {/* Build / Skip — operator review gate */}
      {(canBuild || canSkip) && (
        <Section label={canBuild ? "Build website" : "Triage"}>
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
          {stageCanBuild && !buildable && (
            <p className="text-[12px] text-ink-muted mb-3">
              The website builder covers only Trades, Dental, Chiropractic, Restaurants &amp; Auto Shops.
              This lead&apos;s niche isn&apos;t built — it stays available for outreach.
            </p>
          )}
          {canSkip && (
            <Button
              variant={canBuild ? "soft" : "soft-danger"}
              className={cx("w-full", (canBuild || (stageCanBuild && !buildable)) && "mt-2")}
              onClick={skipLead}
              loading={skipping}
            >
              {!skipping && <XCircle strokeWidth={2.5} />}
              {skipping ? "Skipping…" : "Skip this lead"}
            </Button>
          )}
        </Section>
      )}

      {/* Email + outreach trigger */}
      <Section label="Contact" id="contact-card">
        <div className="space-y-3">
          {editingEmail ? (
            <div className="flex gap-2">
              <input
                ref={emailInputRef}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@business.com"
                type="email"
                className="flex-1 h-9 px-3 text-body-base border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none"
              />
              <Button onClick={saveEmail} loading={savingEmail}>
                Save
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-ink-muted">{lead.email}</span>
              <button onClick={() => setEditingEmail(true)} className="text-ink-subtle hover:text-ink-muted">
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}

          <p className="text-[11px] text-ink-subtle">
            Outreach is by phone — use the Voice outreach panel above to queue a call.
          </p>
        </div>
      </Section>

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

      {/* Rebuild — refresh template/code without flipping stage. Used when
          a template/code change has shipped and we want this lead's demo
          to pick it up. NOT for adding the customer's real data — that's
          the Improve form below. */}
      {canRebuild && (
        <Section label="Rebuild site">
          <p className="text-[12px] text-ink-muted mb-2">
            Re-run enrich + generate + deploy on the latest template + code. Picks up logo, brand color, and copy changes. Doesn&apos;t change the lead&apos;s stage.
          </p>
          <Button
            variant="soft"
            className="w-full"
            onClick={() => setRebuildConfirmOpen(true)}
            loading={rebuilding}
          >
            {!rebuilding && <RefreshCw />}
            {rebuilding ? "Rebuilding… (~60–90s)" : "Rebuild on latest template"}
          </Button>
        </Section>
      )}
      {rebuildConfirmOpen && (
        <RebuildConfirmModal
          onConfirm={rebuildSite}
          onClose={() => setRebuildConfirmOpen(false)}
        />
      )}

      {/* Improve — also a builder action, so only for focus niches. */}
      {buildable && (
        <Section label="Improve site" id="improve-section">
          <p className="text-[12px] text-ink-muted mb-2">Rebuild with the customer&apos;s real photos, hours, and copy edits. Marks the lead as &apos;improved&apos;.</p>
          <Button variant="soft-action" className="w-full" onClick={() => setImproveOpen(true)}>
            <MessageSquarePlus /> Open improve form
          </Button>
        </Section>
      )}

      {/* Handover */}
      <Section label="Hand over" id="handover-section">
        {isHandedOver ? (
          <div className="text-sm rounded-lg bg-positive-soft border border-positive/30 px-3 py-2 text-positive">
            Live on <span className="font-mono font-semibold">{lead.custom_domain}</span>
            {lead.handover_mode === "transfer" && <span className="ml-1 text-positive">(transferred)</span>}
          </div>
        ) : (
          <Button
            variant="soft-positive"
            className="w-full"
            onClick={() => setHandoverOpen(true)}
            disabled={!lead.demo_url}
          >
            <Building /> Attach customer domain
          </Button>
        )}
      </Section>

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

      {improveOpen && <ImproveModal leadId={lead.id} onClose={() => setImproveOpen(false)} />}
      {handoverOpen && <HandoverModal leadId={lead.id} onClose={() => setHandoverOpen(false)} />}
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
