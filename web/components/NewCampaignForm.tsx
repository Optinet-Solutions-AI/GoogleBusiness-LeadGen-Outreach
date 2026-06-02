"use client";

/**
 * NewCampaignForm.tsx — "New campaign" toggle button + modal for creating
 * app-sourced, CSV-imported, or manually-entered call campaigns.
 *
 * Inputs:  User form values; POSTs to /api/leads/import, /api/leads, /api/campaigns
 * Outputs: New row in call_campaigns (+ campaign_leads); refreshes the /campaigns page
 * Used by: app/(dashboard)/campaigns/page.tsx
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = "app" | "csv" | "manual";
type Segment = "no_website" | "old_website" | "has_website";

interface ManualRow {
  business_name: string;
  phone: string;
  city: string;
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
      className={[
        "flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors",
        active
          ? "bg-action text-white shadow-sm"
          : "text-ink-muted hover:text-ink hover:bg-surface",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className={LABEL_CLS}>{label}</label>
      {children}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

function NewCampaignModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  // Shared state
  const [source, setSource] = useState<Source>("app");
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<Segment>("no_website");
  const [callDays, setCallDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(20);

  // App-source state
  const [countryCode, setCountryCode] = useState("us");
  const [category, setCategory] = useState("");
  const [targetCount, setTargetCount] = useState(50);

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

  // ── CSV header detection ──────────────────────────────────────────────────
  const handleCsvChange = useCallback((text: string) => {
    setCsvText(text);
    const headers = parseHeaders(text);
    setCsvHeaders(headers);
    // Auto-map fields whose header name matches a known target (case-insensitive)
    const autoMap: Partial<Record<MappingField, string>> = {};
    for (const field of MAPPING_FIELDS) {
      const match = headers.find((h) => h.toLowerCase() === field.toLowerCase());
      if (match) autoMap[field] = match;
    }
    setMapping(autoMap);
  }, []);

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

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    setError(null);

    // Basic validation
    if (!name.trim()) {
      setError("Campaign name is required.");
      return;
    }
    if (callDays.length === 0) {
      setError("Select at least one call day.");
      return;
    }
    if (startHour >= endHour) {
      setError("Start hour must be before end hour.");
      return;
    }

    setLoading(true);

    const scheduleFields = {
      call_days: callDays,
      call_start_hour: startHour,
      call_end_hour: endHour,
    };

    try {
      if (source === "app") {
        const res = await fetchJson<{ campaign: unknown }>("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            source: "app",
            segment,
            country_code: countryCode.trim() || undefined,
            category: category.trim() || undefined,
            target_count: targetCount,
            ...scheduleFields,
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
        // Step 1: import leads
        const importRes = await fetchJson<{ lead_ids: string[] }>("/api/leads/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv_text: csvText, mapping }),
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
        // Step 2: create campaign
        const campRes = await fetchJson<{ campaign: unknown }>("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            source: "csv",
            segment,
            lead_ids: leadIds,
            ...scheduleFields,
          }),
        });
        if (!campRes.success) {
          setError(campRes.error);
          setLoading(false);
          return;
        }
      } else {
        // manual
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
            segment,
            lead_ids: leadIds,
            ...scheduleFields,
          }),
        });
        if (!campRes.success) {
          setError(campRes.error);
          setLoading(false);
          return;
        }
      }

      // Success
      router.refresh();
      onClose();
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <section
        className="bg-white w-full max-w-[520px] rounded-xl border border-rule shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-rule flex justify-between items-center flex-none">
          <h2 className="text-[15px] font-semibold text-ink">New campaign</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-subtle hover:text-ink-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
          {/* Source toggle */}
          <div className="space-y-1.5">
            <label className={LABEL_CLS}>Source</label>
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
          </div>

          {/* Common: Name */}
          <Field label="Campaign name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Plumbers — Austin June"
              className={INPUT_CLS}
            />
          </Field>

          {/* Common: Segment */}
          <Field label="Segment">
            <select
              value={segment}
              onChange={(e) => setSegment(e.target.value as Segment)}
              className={INPUT_CLS}
            >
              {SEGMENTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Common: Schedule */}
          <div className="space-y-3">
            <label className={LABEL_CLS}>Schedule</label>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={[
                    "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                    callDays.includes(d.value)
                      ? "bg-action text-white"
                      : "bg-surface-alt border border-rule text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="flex gap-3 items-center">
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-ink-muted uppercase tracking-wider">
                  Start hour (0–23)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={startHour}
                  onChange={(e) => setStartHour(Math.min(23, Math.max(0, Number(e.target.value))))}
                  className={INPUT_CLS}
                />
              </div>
              <span className="text-ink-muted text-sm mt-5">–</span>
              <div className="flex-1 space-y-1">
                <label className="text-[10px] text-ink-muted uppercase tracking-wider">
                  End hour (0–23)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={endHour}
                  onChange={(e) => setEndHour(Math.min(23, Math.max(0, Number(e.target.value))))}
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </div>

          {/* ── App source fields ── */}
          {source === "app" && (
            <div className="space-y-4 pt-1 border-t border-rule">
              <p className="text-[11px] text-ink-muted pt-2">
                Snapshots leads from the database matching the segment + filters below.
              </p>
              <Field label="Country code (e.g. us, gb, au)">
                <input
                  type="text"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  placeholder="us"
                  maxLength={4}
                  className={INPUT_CLS}
                />
              </Field>
              <Field label="Category (optional)">
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. plumber"
                  className={INPUT_CLS}
                />
              </Field>
              <Field label="Target count">
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={targetCount}
                  onChange={(e) =>
                    setTargetCount(Math.min(5000, Math.max(1, Number(e.target.value))))
                  }
                  className={INPUT_CLS}
                />
              </Field>
            </div>
          )}

          {/* ── CSV source fields ── */}
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
                          <th className="px-3 py-2 text-left text-ink-muted font-semibold">
                            Field
                          </th>
                          <th className="px-3 py-2 text-left text-ink-muted font-semibold">
                            CSV column
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rule">
                        {MAPPING_FIELDS.map((field) => (
                          <tr key={field}>
                            <td className="px-3 py-2 text-ink font-medium">
                              {FIELD_LABELS[field]}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={mapping[field] ?? ""}
                                onChange={(e) =>
                                  setMapping((prev) => ({
                                    ...prev,
                                    [field]: e.target.value || undefined,
                                  }))
                                }
                                className="w-full h-7 px-2 text-[12px] border border-rule-strong rounded focus:ring-1 focus:ring-action/20 focus:border-action outline-none"
                              >
                                {field === "phone" ? (
                                  <option value="" disabled>Select column…</option>
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
                    {csvHeaders.length} column{csvHeaders.length !== 1 ? "s" : ""} detected from
                    first row.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Manual source fields ── */}
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
                className="flex items-center gap-1.5 text-[12px] font-semibold text-action hover:text-action/80 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Add row
              </button>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="rounded-lg bg-urgent-soft border border-urgent/30 px-3 py-2 text-[12px] text-urgent leading-relaxed">
              <p className="font-semibold mb-0.5">Error</p>
              <p className="text-[11px] font-mono break-all">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 bg-surface-alt border-t border-rule flex justify-end items-center gap-3 flex-none">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-full text-ink-muted font-medium hover:bg-rule-strong transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading || !name.trim()}
            className="px-6 py-2 rounded-full bg-action text-white font-semibold hover:opacity-90 transition-all text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating…" : "Create campaign"}
          </button>
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-ink text-canvas px-4 py-2.5 rounded text-[12px] font-semibold tracking-wide flex items-center gap-2 hover:bg-ink/85 transition-colors group"
      >
        <Plus
          className="h-3.5 w-3.5 transition-transform group-hover:rotate-90"
          strokeWidth={2.25}
        />
        New campaign
      </button>
      {open && <NewCampaignModal onClose={() => setOpen(false)} />}
    </>
  );
}
