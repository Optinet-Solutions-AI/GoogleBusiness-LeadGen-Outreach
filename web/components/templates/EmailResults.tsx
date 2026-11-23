"use client";
/**
 * templates/EmailResults.tsx — Templates page: which emails get replies (Results) and wording tests (24 Nov 2026).
 *
 * Inputs:  GET /api/email-results?days=30|90|all · GET /api/email-templates (for the test's version pickers)
 * Outputs: POST /api/email-tests { service_key, a_key, b_key } (start) · PATCH /api/email-tests/:id { winner } (end)
 * Used by: app/(dashboard)/email-templates/page.tsx
 *
 * Dumb client: the counting rules live in lib/email/email-results.ts and the test rules in lib/email/wording-test.ts.
 * A reply counts for the last email sent to that lead before it; edited sends count for the email they started from.
 */
import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { SERVICES } from "@/lib/email/service-templates";
import { ENOUGH_SENDS, type Variant, type WordingTest } from "@/lib/email/wording-test";
import type { ResultRow } from "@/lib/email/email-results";

type TestView = WordingTest & { a: ResultRow; b: ResultRow; enough: boolean };
type Results = { rows: ResultRow[]; tests: TestView[]; testsMissing: boolean };
type Saved = { id: string; name: string; service_key: string | null; archived?: boolean };

const PERIODS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
] as const;
const INPUT = "w-full px-3 py-2 text-[13px] border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white";
const OFFERS = SERVICES.filter((s) => s.key !== "custom");
const offerLabel = (k: string) => SERVICES.find((s) => s.key === k)?.label ?? k;
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 1000) / 10}%`);

function Numbers({ rows, first }: { rows: { label: string; row: ResultRow }[]; first: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-muted">
            <th className="py-1.5 pr-3 font-semibold">{first}</th>
            <th className="py-1.5 px-2 font-semibold text-right">Sent</th>
            <th className="py-1.5 px-2 font-semibold text-right">Replies</th>
            <th className="py-1.5 px-2 font-semibold text-right">Reply rate</th>
            <th className="py-1.5 px-2 font-semibold text-right" title="Changed before sending (still counted for this email)">Edited</th>
            <th className="py-1.5 px-2 font-semibold text-right" title="Unsubscribed or marked it as spam">Unsubscribed</th>
            <th className="py-1.5 pl-2 font-semibold text-right">Bounced</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map(({ label, row }) => (
            <tr key={label} className="text-ink">
              <td className="py-1.5 pr-3">{label}</td>
              <td className="py-1.5 px-2 text-right mono-num">{row.sent}</td>
              <td className="py-1.5 px-2 text-right mono-num">{row.replies}</td>
              <td className="py-1.5 px-2 text-right mono-num font-semibold">{pct(row.rate)}</td>
              <td className="py-1.5 px-2 text-right mono-num text-ink-muted">{row.edited}</td>
              <td className="py-1.5 px-2 text-right mono-num text-ink-muted">{row.unsubscribed}</td>
              <td className="py-1.5 pl-2 text-right mono-num text-ink-muted">{row.bounced}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmailResults() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("30");
  const [data, setData] = useState<Results | null>(null);
  const [starting, setStarting] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [form, setForm] = useState({ service_key: "", a_key: "", b_key: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<Results>(`/api/email-results?days=${period}`);
    if (r.success) setData(r.data);
    else toast.error(r.error, { title: "Couldn't load the results" });
  }, [period]);
  useEffect(() => {
    void load();
  }, [load]);

  async function openStart() {
    setStarting(true);
    const r = await fetchJson<{ templates: Saved[] }>("/api/email-templates");
    setSaved(r.success ? r.data.templates : []);
  }

  async function start() {
    setBusy(true);
    const r = await fetchJson<WordingTest>("/api/email-tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (!r.success) return void toast.error(r.error, { title: "Test not started" });
    toast.success(`Wording test started for "${offerLabel(r.data.service_key)}". Send email now takes turns between version A and B.`);
    setStarting(false);
    setForm({ service_key: "", a_key: "", b_key: "" });
    void load();
  }

  async function end(t: TestView, winner: Variant) {
    const keep = winner === "A" ? t.a_label : t.b_label;
    const warn = t.enough ? "" : `\n\nEach version has fewer than ${ENOUGH_SENDS} sends, so the numbers may be luck.`;
    if (!window.confirm(`End this test and keep version ${winner} ("${keep}")?${warn}`)) return;
    setBusy(true);
    const r = await fetchJson<WordingTest>(`/api/email-tests/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ winner }) });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(`Test ended. Send email now starts "${offerLabel(t.service_key)}" with version ${winner}.`);
    void load();
  }

  const offerSaved = saved.filter((s) => !s.archived && (!s.service_key || s.service_key === form.service_key));
  const running = (data?.tests ?? []).filter((t) => t.status === "running");
  const done = (data?.tests ?? []).filter((t) => t.status === "done");

  return (
    <div className="mt-6 space-y-4">
      <section className="bg-surface border border-rule rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-muted">Results: which emails get replies</div>
            <p className="text-[12px] text-ink-muted">
              A reply counts for the last email sent to that lead before it. Under about 50 sends an email&rsquo;s reply rate can swing a lot.
            </p>
          </div>
          <div className="flex gap-1" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                aria-pressed={period === p.value}
                className={period === p.value ? "rounded bg-ink px-2 py-1 text-[12px] font-semibold text-canvas" : "rounded border border-rule px-2 py-1 text-[12px] text-ink-muted hover:bg-surface-alt"}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {data === null ? (
          <p className="text-[13px] text-ink-muted">Loading…</p>
        ) : data.rows.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No emails sent in this period.</p>
        ) : (
          <Numbers first="Email used" rows={data.rows.map((row) => ({ label: row.label, row }))} />
        )}
      </section>

      <section className="bg-surface border border-rule rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-muted">Wording tests</div>
            <p className="text-[12px] text-ink-muted">
              Two versions of one offer&rsquo;s email. Send email takes turns between them; you end the test and keep the one that gets more replies.
            </p>
          </div>
          {!starting && !data?.testsMissing && (
            <Button size="sm" variant="secondary" onClick={openStart}>
              <FlaskConical className="h-4 w-4" /> Start a wording test
            </Button>
          )}
        </div>

        {data?.testsMissing && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] text-ink">
            Wording tests need database update 066. Run <span className="font-mono">db/migrations/066_email_tests.sql</span> in Supabase, then reload.
          </div>
        )}

        {starting && (
          <div className="rounded-lg border border-rule p-3 space-y-2">
            <select className={INPUT} aria-label="Offer to test" value={form.service_key} onChange={(e) => setForm({ service_key: e.target.value, a_key: e.target.value ? `service:${e.target.value}` : "", b_key: "" })}>
              <option value="">Which offer&rsquo;s email?</option>
              {OFFERS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            {form.service_key && (
              <>
                <label className="block text-[11px] font-semibold text-ink-muted">
                  Version A (the email used now)
                  <select className={INPUT} value={form.a_key} onChange={(e) => setForm({ ...form, a_key: e.target.value })}>
                    <option value={`service:${form.service_key}`}>Ready-made: {offerLabel(form.service_key)}</option>
                    {offerSaved.map((s) => (
                      <option key={s.id} value={`saved:${s.id}`}>Saved: {s.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-semibold text-ink-muted">
                  Version B (a saved template)
                  <select className={INPUT} value={form.b_key} onChange={(e) => setForm({ ...form, b_key: e.target.value })}>
                    <option value="">Pick a saved template…</option>
                    {offerSaved
                      .filter((s) => `saved:${s.id}` !== form.a_key)
                      .map((s) => (
                        <option key={s.id} value={`saved:${s.id}`}>{s.name}</option>
                      ))}
                  </select>
                </label>
                {offerSaved.length === 0 && (
                  <p className="text-[12px] text-ink-muted">No saved template for this offer yet. Write version B below with &ldquo;New template&rdquo; (set its offer), then come back.</p>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setStarting(false)}>Cancel</Button>
              <Button size="sm" onClick={start} loading={busy} disabled={busy || !form.service_key || !form.a_key || !form.b_key}>
                Start test
              </Button>
            </div>
          </div>
        )}

        {running.map((t) => (
          <div key={t.id} className="rounded-lg border border-action/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-ink">{offerLabel(t.service_key)}</div>
              <div className="text-[11px] text-ink-subtle">Running since {new Date(t.started_at).toLocaleDateString()}</div>
            </div>
            <Numbers first="Version" rows={[{ label: `A · ${t.a_label}`, row: t.a }, { label: `B · ${t.b_label}`, row: t.b }]} />
            <p className={t.enough ? "text-[12px] text-positive" : "text-[12px] text-ink-muted"}>
              {t.enough
                ? "Each version has enough sends to compare."
                : `Not enough sends yet: each version needs ${ENOUGH_SENDS} (A has ${t.a.sent}, B has ${t.b.sent}).`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => end(t, "A")} disabled={busy}>
                <Trophy className="h-3.5 w-3.5" /> Keep A
              </Button>
              <Button size="sm" variant="secondary" onClick={() => end(t, "B")} disabled={busy}>
                <Trophy className="h-3.5 w-3.5" /> Keep B
              </Button>
            </div>
          </div>
        ))}

        {done.length > 0 && (
          <details className="text-[12px] text-ink-muted">
            <summary className="cursor-pointer">Finished tests ({done.length})</summary>
            <ul className="mt-2 space-y-1">
              {done.map((t) => (
                <li key={t.id}>
                  {offerLabel(t.service_key)}: kept <span className="font-semibold text-ink">{t.winner === "A" ? t.a_label : t.b_label}</span> (A {pct(t.a.rate)} of {t.a.sent}, B{" "}
                  {pct(t.b.rate)} of {t.b.sent}){t.ended_at ? `, ended ${new Date(t.ended_at).toLocaleDateString()}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        {!data?.testsMissing && running.length === 0 && done.length === 0 && !starting && (
          <p className="text-[13px] text-ink-muted">No wording tests yet.</p>
        )}
      </section>
    </div>
  );
}
