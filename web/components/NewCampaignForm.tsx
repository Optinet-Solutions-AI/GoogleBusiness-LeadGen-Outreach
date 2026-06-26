"use client";

/**
 * NewCampaignForm.tsx — "New campaign" toggle button + a 4-step WIZARD modal for
 * creating app-sourced, CSV-imported, or manually-entered campaigns.
 *
 * Steps:  1 Source & name → 2 Audience (channel + filters) → 3 Schedule → 4 Review.
 * Inputs:  user form values; POSTs to /api/leads/import, /api/leads, /api/campaigns
 * Outputs: new row in call_campaigns (+ campaign_leads); refreshes /campaigns
 * Used by: app/(dashboard)/campaigns/page.tsx
 *
 * Per the UX skill: a step indicator, per-step validation on Continue, and a
 * Review step before the (toast-confirmed) create.
 */

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Check, Mail, MessageSquare, Share2 } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { cx } from "@/lib/cx";
import { CHANNELS, type Channel } from "@/lib/campaigns/eligibility";
import { campaignTimezone } from "@/lib/call-hours";
import { COUNTRIES } from "@/lib/data/cities";
import { NICHE_OPTIONS, NICHE_CATEGORIES } from "@/lib/data/niches";
import { CampaignCopyEditor, type CopyOverrides } from "@/components/CampaignCopyEditor";
import { resolveSegment, type CallSegment } from "@/lib/segment";

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = "app" | "csv" | "manual";
type Segment = "no_website" | "old_website" | "has_website";

interface ManualRow {
  business_name: string;
  phone: string;
  city: string;
}

interface SampleLead {
  id: string;
  business_name: string;
  address: string | null;
  country_code: string | null;
  category: string | null;
  email: string | null;
  phone: string | null;
  website_kind: string | null;
  demo_url: string | null;
  call_segment: string | null;
  needs_improvement: boolean | null;
}

/** Minimal shape needed to LIST a selected lead (sample rows + "select all" rows). */
interface SelectedLead {
  id: string;
  business_name: string;
  category: string | null;
  country_code: string | null;
  email: string | null;
  phone: string | null;
}

/** A short "category · COUNTRY" line for a preview row. */
function previewPlace(l: { category: string | null; country_code: string | null }): string {
  return [l.category, l.country_code?.toUpperCase()].filter(Boolean).join(" · ") || "—";
}

// CSV mapping field names (phone is required; the rest optional)
const MAPPING_FIELDS = ["phone", "business_name", "city", "country_code", "website_url"] as const;
type MappingField = (typeof MAPPING_FIELDS)[number];

const FIELD_LABELS: Record<MappingField, string> = {
  phone: "Phone (required)",
  business_name: "Business name",
  city: "City",
  country_code: "Country code",
  website_url: "Website URL",
};

const WEEKDAYS: { label: string; value: number }[] = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 7 },
];

const SEGMENTS: { label: string; value: Segment }[] = [
  { label: "No website", value: "no_website" },
  { label: "Old website", value: "old_website" },
  { label: "Has website", value: "has_website" },
];

/** "9:00 AM", "8:00 PM", "12:00 AM" for an hour 0-23 (the send-window picker). */
function hourLabel(h: number): string {
  const period = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${period}`;
}
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const SOURCE_LABEL: Record<Source, string> = {
  app: "From database",
  csv: "CSV upload",
  manual: "Manual",
};

const SOURCE_HINT: Record<Source, string> = {
  app: "Pull from leads you've already scraped — you'll filter them on the next step.",
  csv: "Paste a list of leads (CSV) — you'll map the columns next.",
  manual: "Type a few leads in by hand.",
};

const STEP_LABELS = ["Basics", "Audience", "Timing", "Review"];

const INPUT_CLS =
  "w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white";

const LABEL_CLS = "block text-[11px] font-semibold uppercase tracking-wider text-ink-muted";

// ─── Helper: parse first CSV line → headers ───────────────────────────────────

function parseHeaders(csvText: string): string[] {
  const firstLine = csvText.split(/\r?\n/)[0] ?? "";
  if (!firstLine.trim()) return [];
  return firstLine.split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SourceTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors",
        active ? "bg-ink text-canvas shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface",
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={LABEL_CLS}>{label}</label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle flex-shrink-0">
        {label}
      </dt>
      <dd className="text-[13px] text-ink text-right truncate">{value}</dd>
    </div>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────────

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mt-3">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={cx(
                "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider",
                current ? "text-ink" : done ? "text-ink-muted" : "text-ink-subtle",
              )}
            >
              <span
                className={cx(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  current || done
                    ? "bg-ink text-canvas"
                    : "bg-surface-alt text-ink-subtle border border-rule",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </span>
            {n < STEP_LABELS.length && <span className="h-px w-3 bg-rule" />}
          </div>
        );
      })}
    </div>
  );
}

/** Small channel glyph for the wizard's persistent channel chip. */
function ChannelIcon({ channel }: { channel: Channel }) {
  const cls = "h-3.5 w-3.5";
  if (channel === "email") return <Mail className={cls} strokeWidth={2} />;
  if (channel === "sms") return <MessageSquare className={cls} strokeWidth={2} />;
  return <Share2 className={cls} strokeWidth={2} />;
}

function StepIntro({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-ink leading-snug">{title}</h3>
      <p className="text-[12.5px] text-ink-muted mt-1 leading-relaxed">{description}</p>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  // Wizard step (1–4)
  const [step, setStep] = useState(1);

  // Shared state
  const [source, setSource] = useState<Source>("app");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [segment, setSegment] = useState<Segment | "">("");
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [sample, setSample] = useState<SampleLead[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Directory of lead summaries we know about (the visible sample + any pulled
  // via "Select all N"), so the "View selected" panel can name every picked lead
  // even the ones beyond the first page. Keyed by id.
  const [leadDir, setLeadDir] = useState<Record<string, SelectedLead>>({});
  const [showSelected, setShowSelected] = useState(false);
  const [mailboxes, setMailboxes] = useState<{ email: string; from_name: string | null }[]>([]);
  // Multiple sending mailboxes — the engine rotates across them (one pinned per
  // lead at first send). Defaults to all connected mailboxes.
  const [senderEmails, setSenderEmails] = useState<string[]>([]);
  const [callDays, setCallDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(20);

  // App-source state
  const [countryCode, setCountryCode] = useState("us");
  const [category, setCategory] = useState("");

  // Per-step copy overrides (email only). Blank steps fall back to the default.
  const [copyOverrides, setCopyOverrides] = useState<CopyOverrides>({});

  // CSV-source state
  const [csvText, setCsvText] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<MappingField, string>>>({});

  // Manual-source state
  const [manualRows, setManualRows] = useState<ManualRow[]>([
    { business_name: "", phone: "", city: "" },
  ]);

  // Submit state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live matching leads for the chosen channel (+ filters). App source only.
  // Debounced 300ms so typing in country/category doesn't fire a request per keystroke.
  useEffect(() => {
    if (source !== "app") {
      setMatchCount(null);
      setSample([]);
      setSelectedIds(new Set());
      setLeadDir({});
      setShowSelected(false);
      return;
    }
    let cancelled = false;
    setMatchCount(null); // show "Loading…" while filters change
    const params = new URLSearchParams({ channel });
    if (segment) params.set("segment", segment);
    if (countryCode.trim()) params.set("country_code", countryCode.trim());
    if (category.trim()) params.set("category", category.trim());
    const t = setTimeout(() => {
      fetchJson<{ count: number; sample: SampleLead[] }>(`/api/leads/count?${params.toString()}`).then((r) => {
        if (cancelled) return;
        const s = r.success ? r.data.sample : [];
        setMatchCount(r.success ? r.data.count : null);
        setSample(s);
        setSelectedIds(new Set(s.map((l) => l.id))); // default: everything shown is picked
        setShowSelected(false);
        setLeadDir(() => {
          const dir: Record<string, SelectedLead> = {};
          for (const l of s) dir[l.id] = l;
          return dir;
        });
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [source, channel, segment, countryCode, category]);

  // Active mailboxes for the Sender picker (email channel only).
  useEffect(() => {
    if (channel !== "email") return;
    let cancelled = false;
    fetchJson<{ mailboxes: { email: string; from_name: string | null }[] }>("/api/email-accounts").then((r) => {
      if (cancelled || !r.success) return;
      setMailboxes(r.data.mailboxes);
      // Default to ALL mailboxes selected (rotate across everything connected).
      setSenderEmails((cur) => (cur.length ? cur : r.data.mailboxes.map((m) => m.email)));
    });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  // ── CSV header detection ──────────────────────────────────────────────────
  const handleCsvChange = useCallback((text: string) => {
    setCsvText(text);
    const headers = parseHeaders(text);
    setCsvHeaders(headers);
    const autoMap: Partial<Record<MappingField, string>> = {};
    for (const field of MAPPING_FIELDS) {
      const match = headers.find((h) => h.toLowerCase() === field.toLowerCase());
      if (match) autoMap[field] = match;
    }
    setMapping(autoMap);
  }, []);

  // Select EVERY matching lead (not just the visible sample) by pulling the full
  // id list with the same filters. Lets a campaign include all N, not just 50.
  const [selectingAll, setSelectingAll] = useState(false);
  async function selectAllMatching() {
    setSelectingAll(true);
    const params = new URLSearchParams({ channel });
    if (segment) params.set("segment", segment);
    if (countryCode.trim()) params.set("country_code", countryCode.trim());
    if (category.trim()) params.set("category", category.trim());
    params.set("withIds", "1");
    const r = await fetchJson<{ count: number; ids: string[]; members?: SelectedLead[] }>(
      `/api/leads/count?${params.toString()}`,
    );
    setSelectingAll(false);
    if (!r.success) return;
    if (r.data.members?.length) {
      setLeadDir((prev) => {
        const dir = { ...prev };
        for (const m of r.data.members!) dir[m.id] = m;
        return dir;
      });
      setSelectedIds(new Set(r.data.members.map((m) => m.id)));
    } else if (r.data.ids) {
      setSelectedIds(new Set(r.data.ids));
    }
  }

  // ── Schedule helpers ──────────────────────────────────────────────────────
  function toggleDay(value: number) {
    setCallDays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort((a, b) => a - b),
    );
  }

  // ── Manual rows ───────────────────────────────────────────────────────────
  function updateRow(index: number, field: keyof ManualRow, value: string) {
    setManualRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    setManualRows((prev) => [...prev, { business_name: "", phone: "", city: "" }]);
  }
  function removeRow(index: number) {
    setManualRows((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Step navigation + per-step validation ──────────────────────────────────
  function validateStep(s: number): string | null {
    if (s === 1 && !name.trim()) return "Campaign name is required.";
    if (s === 2) {
      if (source === "csv") {
        if (!csvText.trim()) return "Paste CSV text first.";
        if (!mapping.phone) return "Map the phone column before continuing.";
      }
      if (source === "manual" && !manualRows.some((r) => r.phone.trim())) {
        return "Add at least one row with a phone number.";
      }
      if (source === "app" && selectedIds.size === 0) {
        return matchCount === 0
          ? "No leads match this channel + filters. Adjust them."
          : "Pick at least one lead to add.";
      }
    }
    if (s === 3) {
      if (callDays.length === 0) return "Select at least one call day.";
      if (startHour >= endHour) return "Start hour must be before end hour.";
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((x) => Math.min(STEP_LABELS.length, x + 1));
  }
  function back() {
    setError(null);
    setStep((x) => Math.max(1, x - 1));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Campaign name is required.");
      setStep(1);
      return;
    }
    setLoading(true);
    const scheduleFields = {
      call_days: callDays,
      call_start_hour: startHour,
      call_end_hour: endHour,
    };
    const emailSender =
      channel === "email" && senderEmails.length
        ? { sender_emails: senderEmails, sender_email: senderEmails[0] }
        : {};
    const emailCopy =
      channel === "email" && Object.keys(copyOverrides).length ? { copy_overrides: copyOverrides } : {};

    try {
      if (source === "app") {
        const res = await fetchJson<{ campaign: unknown }>("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            source: "app",
            channel,
            segment: segment || undefined,
            country_code: countryCode.trim() || undefined,
            category: category.trim() || undefined,
            lead_ids: [...selectedIds],
            ...scheduleFields,
            ...emailSender,
            ...emailCopy,
          }),
        });
        if (!res.success) {
          setError(res.error);
          setLoading(false);
          return;
        }
      } else if (source === "csv") {
        if (!csvText.trim()) {
          setError("Paste CSV text first.");
          setLoading(false);
          return;
        }
        if (!mapping.phone) {
          setError("Map the phone column before importing.");
          setLoading(false);
          return;
        }
        const importRes = await fetchJson<{ lead_ids: string[] }>("/api/leads/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv_text: csvText, mapping, segment: segment || "no_website" }),
        });
        if (!importRes.success) {
          setError(importRes.error);
          setLoading(false);
          return;
        }
        const leadIds = importRes.data.lead_ids;
        if (!leadIds?.length) {
          setError("Import returned no valid leads.");
          setLoading(false);
          return;
        }
        const campRes = await fetchJson<{ campaign: unknown }>("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            source: "csv",
            channel,
            segment: segment || "no_website",
            lead_ids: leadIds,
            ...scheduleFields,
            ...emailSender,
            ...emailCopy,
          }),
        });
        if (!campRes.success) {
          setError(campRes.error);
          setLoading(false);
          return;
        }
      } else {
        const validRows = manualRows.filter((r) => r.phone.trim());
        if (validRows.length === 0) {
          setError("Add at least one row with a phone number.");
          setLoading(false);
          return;
        }
        const leadIds: string[] = [];
        for (const row of validRows) {
          const res = await fetchJson<{ lead_id: string }>("/api/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              business_name: row.business_name.trim() || undefined,
              phone: row.phone.trim(),
              city: row.city.trim() || undefined,
              segment: segment || "no_website",
            }),
          });
          if (!res.success) {
            setError(`Row "${row.phone}": ${res.error}`);
            setLoading(false);
            return;
          }
          leadIds.push(res.data.lead_id);
        }
        const campRes = await fetchJson<{ campaign: unknown }>("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            source: "manual",
            channel,
            segment: segment || "no_website",
            lead_ids: leadIds,
            ...scheduleFields,
            ...emailSender,
            ...emailCopy,
          }),
        });
        if (!campRes.success) {
          setError(campRes.error);
          setLoading(false);
          return;
        }
      }

      toast.success("Campaign created as a draft. Run a test send, then launch it to start sending.");
      router.refresh();
      onClose();
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  const channelHint = CHANNELS.find((c) => c.value === channel)?.hint;
  const channelLabel = CHANNELS.find((c) => c.value === channel)?.label ?? channel;
  const manualWithPhone = manualRows.filter((r) => r.phone.trim()).length;
  // Channel-appropriate noun for the scheduling step ("emails" or "messages").
  const sendNoun = channel === "email" ? "emails" : "messages";
  const sendNounCap = sendNoun.charAt(0).toUpperCase() + sendNoun.slice(1);
  const segmentLabel = segment ? SEGMENTS.find((s) => s.value === segment)?.label?.toLowerCase() : "any";
  const daysLabel = callDays
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.label)
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[560px] rounded-xl border border-rule shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + stepper */}
        <header className="px-6 pt-4 pb-3 border-b border-rule flex-none">
          <div className="flex justify-between items-center">
            <h2 className="text-[15px] font-semibold text-ink">New campaign</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-ink-subtle hover:text-ink transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <Stepper step={step} />
          {step >= 2 && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[11px] min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-ink text-canvas font-semibold flex-none">
                <ChannelIcon channel={channel} />
                {channelLabel}
              </span>
              {channel === "email" && (
                <span className="text-ink-muted truncate">
                  rotating across{" "}
                  <span className="font-medium text-ink">
                    {senderEmails.length === 0
                      ? "all active mailboxes"
                      : senderEmails.length === 1
                        ? senderEmails[0]
                        : `${senderEmails.length} mailboxes`}
                  </span>
                </span>
              )}
            </div>
          )}
        </header>

        {/* Body — one panel per step */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
          {/* ── Step 1: Basics ── */}
          {step === 1 && (
            <>
              <StepIntro
                title="Name it & choose your leads"
                description="A label for you, plus where this campaign's leads come from. You'll pick the channel and audience next."
              />

              <Field label="Campaign name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Gyms — Yogyakarta June"
                  className={INPUT_CLS}
                  autoFocus
                />
              </Field>

              <div className="space-y-1.5">
                <label className={LABEL_CLS}>Lead source</label>
                <div className="flex gap-1 p-1 bg-surface-alt rounded-lg border border-rule">
                  <SourceTab active={source === "app"} onClick={() => setSource("app")}>
                    From database
                  </SourceTab>
                  <SourceTab active={source === "csv"} onClick={() => setSource("csv")}>
                    CSV upload
                  </SourceTab>
                  <SourceTab active={source === "manual"} onClick={() => setSource("manual")}>
                    Manual
                  </SourceTab>
                </div>
                <p className="text-[11px] text-ink-muted">{SOURCE_HINT[source]}</p>
              </div>
            </>
          )}

          {/* ── Step 2: Audience ── */}
          {step === 2 && (
            <>
              <StepIntro
                title="Who you reach — and how"
                description={
                  source === "app"
                    ? "Pick a channel (only leads reachable that way are included), then optionally narrow the list."
                    : "Pick the channel you'll use to contact the leads in your list."
                }
              />

              <Field label="Channel">
                <div className="grid grid-cols-2 gap-1.5">
                  {CHANNELS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setChannel(c.value)}
                      title={c.hint}
                      className={cx(
                        "px-3 py-2 rounded-lg text-[12px] font-semibold border text-left transition-colors",
                        channel === c.value
                          ? "bg-ink text-canvas border-ink"
                          : "bg-surface-alt border-rule text-ink-muted hover:text-ink",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-ink-muted mt-1">
                  {source === "app"
                    ? `Only leads with ${channelHint} are included.`
                    : `These leads will be contacted by ${channelLabel}.`}
                </p>
              </Field>

              {channel === "email" && (
                <Field label="Send from (rotates across the ones you pick)">
                  {mailboxes.length === 0 ? (
                    <p className="text-[12px] text-ink-muted">
                      No mailbox connected.{" "}
                      <a href="/email-accounts" className="underline underline-offset-2 hover:text-ink">
                        Connect one
                      </a>{" "}
                      to send.
                    </p>
                  ) : (
                    <div className="rounded-lg border border-rule divide-y divide-rule overflow-hidden">
                      {mailboxes.map((m) => {
                        const checked = senderEmails.includes(m.email);
                        return (
                          <label
                            key={m.email}
                            className="px-3 py-2 flex items-center gap-2.5 cursor-pointer hover:bg-surface-alt text-[12.5px]"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSenderEmails((prev) =>
                                  prev.includes(m.email)
                                    ? prev.filter((e) => e !== m.email)
                                    : [...prev, m.email],
                                )
                              }
                              className="cursor-pointer flex-shrink-0"
                            />
                            <span className="truncate text-ink">
                              {m.from_name ? `${m.from_name} <${m.email}>` : m.email}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-[10px] text-ink-muted mt-1">
                    A business is always followed up from the same mailbox it first heard from.
                  </p>
                </Field>
              )}

              {source === "app" && (
                <div className="space-y-4 pt-1 border-t border-rule">
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                      Narrow it down (optional)
                    </p>
                    <span
                      className={cx(
                        "mono-num text-[12px] font-bold px-2 py-0.5 rounded",
                        matchCount === 0 ? "bg-urgent-soft text-urgent" : "bg-surface-alt text-ink",
                      )}
                    >
                      {matchCount === null ? "…" : `${matchCount} match`}
                    </span>
                  </div>
                  <Field label="Segment">
                    <select
                      value={segment}
                      onChange={(e) => setSegment(e.target.value as Segment | "")}
                      className={INPUT_CLS}
                    >
                      <option value="">Any segment</option>
                      {SEGMENTS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Country">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className={INPUT_CLS}
                    >
                      <option value="">Any country</option>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Category (optional)">
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className={INPUT_CLS}
                    >
                      <option value="">Any category</option>
                      {NICHE_CATEGORIES.map((cat) => (
                        <optgroup key={cat} label={cat}>
                          {NICHE_OPTIONS.filter((n) => n.category === cat).map((n) => (
                            <option key={n.value} value={n.value}>
                              {n.value}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                  <div className="pt-1">
                    <div className="flex items-center justify-between mb-2 gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                        Who to add
                        {(sample.length > 0 || selectedIds.size > 0) && (
                          <span className="ml-1.5 normal-case font-normal tracking-normal text-ink-muted">
                            {selectedIds.size} selected
                          </span>
                        )}
                      </p>
                      {(sample.length > 0 || selectedIds.size > 0) && (
                        <div className="flex items-center gap-3 flex-none">
                          {selectedIds.size > 0 && (
                            <button
                              type="button"
                              onClick={() => setShowSelected((v) => !v)}
                              className="text-[11px] text-action font-semibold underline underline-offset-2 hover:text-ink"
                            >
                              {showSelected ? "Hide selected" : `View selected (${selectedIds.size})`}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (selectedIds.size > 0) {
                                setSelectedIds(new Set());
                                setShowSelected(false);
                              } else {
                                setSelectedIds(new Set(sample.map((l) => l.id)));
                              }
                            }}
                            className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink"
                          >
                            {selectedIds.size > 0 ? "Clear all" : "Select all"}
                          </button>
                        </div>
                      )}
                    </div>

                    {showSelected && selectedIds.size > 0 && (
                      <div className="mb-2 rounded-lg border border-action/30 bg-action-soft/30 overflow-hidden">
                        <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-action border-b border-action/20 bg-action-soft/50">
                          {selectedIds.size} selected lead{selectedIds.size === 1 ? "" : "s"}
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-rule/60">
                          {[...selectedIds].map((id) => {
                            const l = leadDir[id];
                            return (
                              <div key={id} className="px-3 py-1.5 flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[12.5px] font-medium text-ink truncate">
                                    {l?.business_name ?? "Selected lead"}
                                  </p>
                                  <p className="text-[10.5px] text-ink-subtle truncate">
                                    {l ? previewPlace(l) : id}
                                  </p>
                                </div>
                                <span className="mono-num text-[10.5px] text-ink-muted truncate max-w-[38%] text-right">
                                  {l?.email ?? l?.phone ?? "—"}
                                </span>
                                <button
                                  type="button"
                                  title="Remove from campaign"
                                  onClick={() =>
                                    setSelectedIds((prev) => {
                                      const n = new Set(prev);
                                      n.delete(id);
                                      return n;
                                    })
                                  }
                                  className="flex-none text-ink-subtle hover:text-urgent text-[15px] leading-none px-1"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {matchCount === null ? (
                      <p className="text-[12px] text-ink-subtle">Loading…</p>
                    ) : sample.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-rule px-4 py-5 text-center">
                        <p className="text-[12.5px] text-ink-muted">No leads match these filters.</p>
                        <p className="text-[11px] text-ink-subtle mt-1">
                          Try clearing the country or segment, or pick a different channel.
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-rule divide-y divide-rule overflow-hidden max-h-64 overflow-y-auto">
                        {sample.map((l) => {
                          const checked = selectedIds.has(l.id);
                          return (
                            <label
                              key={l.id}
                              className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-surface-alt"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedIds((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(l.id)) n.delete(l.id);
                                    else n.add(l.id);
                                    return n;
                                  })
                                }
                                className="cursor-pointer flex-shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium text-ink truncate">{l.business_name}</p>
                                <p className="text-[11px] text-ink-subtle truncate">{previewPlace(l)}</p>
                              </div>
                              <span className="mono-num text-[11px] text-ink-muted truncate max-w-[40%] text-right">
                                {l.email ?? l.phone ?? "—"}
                              </span>
                            </label>
                          );
                        })}
                        {matchCount > sample.length && (
                          <div className="px-3 py-2 text-[11px] bg-surface-alt flex items-center justify-between gap-2">
                            <span className="text-ink-subtle">
                              Showing first {sample.length} of {matchCount}.
                              {selectedIds.size > sample.length && (
                                <span className="text-positive font-semibold"> All {selectedIds.size} selected.</span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={selectAllMatching}
                              disabled={selectingAll}
                              className="text-action font-semibold underline underline-offset-2 hover:text-ink disabled:opacity-50 flex-none"
                            >
                              {selectingAll ? "Selecting…" : `Select all ${matchCount}`}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {source !== "app" && (
                <div className="space-y-2 pt-1 border-t border-rule">
                  <Field label="Outreach for these leads">
                    <select
                      value={segment || "no_website"}
                      onChange={(e) => setSegment(e.target.value as Segment | "")}
                      className={INPUT_CLS}
                    >
                      <option value="no_website">Build a website (no website yet)</option>
                      <option value="old_website">Improve their website (rebuild)</option>
                      <option value="has_website">AI services (they have a good site)</option>
                    </select>
                  </Field>
                  <p className="text-[10.5px] text-ink-muted">
                    {segment === "has_website"
                      ? "Sends the AI-services pitch (2 emails, no demo needed)."
                      : "Sends the " +
                        (segment === "old_website" ? "Improve" : "Build") +
                        " pitch (4 emails). These need a demo site, so Build a demo for each lead before they'll send."}
                  </p>
                </div>
              )}

              {source === "csv" && (
                <div className="space-y-4 pt-1 border-t border-rule">
                  <p className="text-[11px] text-ink-muted pt-2">
                    Paste CSV text. The first row must be headers. Map columns to lead fields below.
                  </p>
                  <Field label="CSV text">
                    <textarea
                      rows={6}
                      value={csvText}
                      onChange={(e) => handleCsvChange(e.target.value)}
                      placeholder={"phone,business_name,city\n+15551234567,Joe's Plumbing,Austin TX"}
                      className="w-full px-3 py-2 text-[12px] font-mono text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none resize-y"
                    />
                  </Field>
                  {csvHeaders.length > 0 && (
                    <div className="space-y-2">
                      <label className={LABEL_CLS}>Column mapping</label>
                      <div className="rounded-lg border border-rule overflow-hidden">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="bg-surface-alt border-b border-rule">
                              <th className="px-3 py-2 text-left text-ink-muted font-semibold">Field</th>
                              <th className="px-3 py-2 text-left text-ink-muted font-semibold">CSV column</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-rule">
                            {MAPPING_FIELDS.map((field) => (
                              <tr key={field}>
                                <td className="px-3 py-2 text-ink font-medium">{FIELD_LABELS[field]}</td>
                                <td className="px-3 py-2">
                                  <select
                                    value={mapping[field] ?? ""}
                                    onChange={(e) =>
                                      setMapping((prev) => ({ ...prev, [field]: e.target.value || undefined }))
                                    }
                                    className="w-full h-7 px-2 text-[12px] border border-rule-strong rounded focus:ring-1 focus:ring-action/20 focus:border-action outline-none"
                                  >
                                    {field === "phone" ? (
                                      <option value="" disabled>
                                        Select column…
                                      </option>
                                    ) : (
                                      <option value="">— skip —</option>
                                    )}
                                    {csvHeaders.map((h) => (
                                      <option key={h} value={h}>
                                        {h}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[10px] text-ink-muted">
                        {csvHeaders.length} column{csvHeaders.length !== 1 ? "s" : ""} detected from first row.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {source === "manual" && (
                <div className="space-y-3 pt-1 border-t border-rule">
                  <p className="text-[11px] text-ink-muted pt-2">
                    Enter leads one at a time. Phone is required per row.
                  </p>
                  <div className="space-y-2">
                    {manualRows.map((row, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <div className="flex-1 grid grid-cols-3 gap-1.5">
                          <input
                            type="text"
                            value={row.business_name}
                            onChange={(e) => updateRow(i, "business_name", e.target.value)}
                            placeholder="Business name"
                            className="h-8 px-2 text-[12px] text-ink border border-rule-strong rounded focus:ring-1 focus:ring-action/20 focus:border-action outline-none"
                          />
                          <input
                            type="tel"
                            value={row.phone}
                            onChange={(e) => updateRow(i, "phone", e.target.value)}
                            placeholder="Phone *"
                            className="h-8 px-2 text-[12px] text-ink border border-rule-strong rounded focus:ring-1 focus:ring-action/20 focus:border-action outline-none"
                          />
                          <input
                            type="text"
                            value={row.city}
                            onChange={(e) => updateRow(i, "city", e.target.value)}
                            placeholder="City"
                            className="h-8 px-2 text-[12px] text-ink border border-rule-strong rounded focus:ring-1 focus:ring-action/20 focus:border-action outline-none"
                          />
                        </div>
                        {manualRows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(i)}
                            className="mt-1 text-ink-subtle hover:text-urgent transition-colors"
                            aria-label="Remove row"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addRow}
                    className="flex items-center gap-1.5 text-[12px] font-semibold text-ink hover:text-ink-muted transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Add row
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── Step 3: Schedule ── */}
          {step === 3 && (
            <>
              <StepIntro
                title={`When should ${sendNoun} go out?`}
                description="The defaults work for most campaigns. This window governs automated sending — you can always send manually too."
              />
              <Field label="Sending days">
                <div className="flex gap-1.5 flex-wrap">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={cx(
                        "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                        callDays.includes(d.value)
                          ? "bg-ink text-canvas"
                          : "bg-surface-alt border border-rule text-ink-muted hover:text-ink",
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="flex gap-3 items-end">
                <Field label="Start time">
                  <select
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                    className={INPUT_CLS}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                </Field>
                <span className="text-ink-muted text-sm pb-2">–</span>
                <Field label="End time">
                  <select
                    value={endHour}
                    onChange={(e) => setEndHour(Number(e.target.value))}
                    className={INPUT_CLS}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="text-[11px] text-ink-muted">
                {sendNounCap} only go out inside this window, on the selected days — times are in{" "}
                <span className="font-semibold text-ink">{campaignTimezone(countryCode)}</span>{" "}
                (set automatically from {countryCode.trim() ? countryCode.trim().toUpperCase() : "the country"}).
              </p>
            </>
          )}

          {/* ── Step 4: Review ── */}
          {step === 4 && (
            <>
              <StepIntro
                title="Review & create"
                description="A quick check before it's created — go Back to change anything."
              />

              <p className="text-[13px] text-ink leading-relaxed bg-surface-alt border border-rule rounded-lg px-4 py-3">
                Create a <span className="font-semibold">{channelLabel}</span> campaign{" "}
                {source === "app" ? (
                  <>
                    targeting <span className="font-semibold">{selectedIds.size}</span> selected{" "}
                    {segmentLabel === "any" ? "" : `${segmentLabel} `}lead{selectedIds.size === 1 ? "" : "s"}
                    {countryCode.trim() ? (
                      <>
                        {" "}in <span className="font-semibold">{countryCode.trim().toUpperCase()}</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    for{" "}
                    <span className="font-semibold">
                      {source === "manual" ? `${manualWithPhone}` : "the imported"}
                    </span>{" "}
                    leads
                  </>
                )}
                , sending {daysLabel || "no days"} · {startHour}:00–{endHour}:00{" "}
                ({campaignTimezone(countryCode)}).
              </p>

              <dl className="rounded-lg border border-rule divide-y divide-rule">
                <SummaryRow label="Name" value={name || "—"} />
                <SummaryRow label="Source" value={SOURCE_LABEL[source]} />
                <SummaryRow label="Channel" value={channelLabel} />
                {channel === "email" && (
                  <SummaryRow
                    label="Senders"
                    value={
                      senderEmails.length === 0
                        ? "all active mailboxes"
                        : senderEmails.length === 1
                          ? senderEmails[0]
                          : `${senderEmails.length} mailboxes (rotated)`
                    }
                  />
                )}
                {source === "app" && (
                  <>
                    <SummaryRow label="Segment" value={segment ? SEGMENTS.find((s) => s.value === segment)?.label : "Any"} />
                    <SummaryRow label="Country" value={countryCode.trim() ? countryCode.trim().toUpperCase() : "—"} />
                    {category.trim() && <SummaryRow label="Category" value={category.trim()} />}
                    <SummaryRow label="Picked" value={`${selectedIds.size} of ${matchCount ?? "…"} matching`} />
                  </>
                )}
                {source === "manual" && (
                  <SummaryRow label="Manual leads" value={`${manualWithPhone} with a phone`} />
                )}
                {source === "csv" && (
                  <SummaryRow label="CSV" value={csvHeaders.length ? `${csvHeaders.length} columns mapped` : "—"} />
                )}
                <SummaryRow label="Send days" value={daysLabel} />
                <SummaryRow label="Send window" value={`${startHour}:00 – ${endHour}:00 (${campaignTimezone(countryCode)})`} />
              </dl>

              {channel === "email" && (() => {
                // Preview the exact emails this campaign will send. Use a selected
                // sample lead for realistic tokens; resolve the segment (the wizard
                // pick if set, else derive from the sample's website signals).
                const s = sample.find((l) => selectedIds.has(l.id)) ?? sample[0];
                const seg: CallSegment = (segment || (s ? resolveSegment(s) : "no_website")) as CallSegment;
                return (
                  <CampaignCopyEditor
                    segment={seg}
                    sample={{ business_name: s?.business_name ?? "Sample Business", demo_url: s?.demo_url ?? null }}
                    value={copyOverrides}
                    onChange={setCopyOverrides}
                  />
                );
              })()}
            </>
          )}
        </div>

        {/* Footer — error + step nav */}
        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex items-center justify-between gap-3 flex-none">
          <p className="text-[12px] text-urgent font-medium min-h-[16px] flex-1 truncate">{error ?? ""}</p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            {step > 1 && (
              <Button variant="secondary" type="button" onClick={back}>
                Back
              </Button>
            )}
            {step < STEP_LABELS.length ? (
              <Button variant="primary" type="button" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button variant="primary" type="button" onClick={submit} loading={loading} disabled={!name.trim()}>
                {loading ? "Creating…" : "Create campaign"}
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

// ─── Public toggle button ──────────────────────────────────────────────────────

export function NewCampaignForm() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="dark" className="group" onClick={() => setOpen(true)}>
        <Plus className="transition-transform group-hover:rotate-90" strokeWidth={2.25} />
        New campaign
      </Button>
      {open && <NewCampaignModal onClose={() => setOpen(false)} />}
    </>
  );
}
