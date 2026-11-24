"use client";
/**
 * batches/DailyBatches.tsx — Batches page: the Daily batches list (24 Nov 2026). Each weekday the next row runs as a
 * 100-lead batch whose email starts by itself 24 h after it finishes, within $40 a month.
 *
 * Inputs:  GET /api/batch-schedules (rows, this month's spend, cap, cost per batch, the next row)
 * Outputs: POST /api/batch-schedules { niche, city, country_code } · PATCH /:id { active } · DELETE /:id
 * Used by: app/(dashboard)/batches/page.tsx
 *
 * Dumb client: the schedule rules live in lib/automation/rules.ts; runs happen on the automation tick (Cloud Run).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Pause, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

type Row = { id: string; niche: string; city: string; country_code: string; active: boolean; last_run_at: string | null; last_batch_id: string | null };
type Overview = { rows: Row[]; missing: boolean; spent: number; cap: number; perBatch: number; limit: number; next: Row | null };

const INPUT = "h-8 px-2 text-[13px] border border-rule-strong rounded-md focus:ring-2 focus:ring-action/20 focus:border-action outline-none bg-white";

export function DailyBatches() {
  const [data, setData] = useState<Overview | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ niche: "", city: "", country_code: "us" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<Overview>("/api/batch-schedules");
    if (r.success) setData(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    const r = await fetchJson("/api/batch-schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (!r.success) return void toast.error(r.error, { title: "Not added" });
    setForm({ niche: "", city: "", country_code: form.country_code });
    void load();
  }
  async function toggle(row: Row) {
    const r = await fetchJson(`/api/batch-schedules/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !row.active }) });
    if (!r.success) return void toast.error(r.error);
    void load();
  }
  async function remove(row: Row) {
    if (!window.confirm(`Remove ${row.niche} / ${row.city} from Daily batches? Batches it already made stay.`)) return;
    const r = await fetchJson(`/api/batch-schedules/${row.id}`, { method: "DELETE" });
    if (!r.success) return void toast.error(r.error);
    void load();
  }

  const active = data?.rows.filter((r) => r.active).length ?? 0;
  return (
    <section className="mb-4 rounded-lg border border-rule bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <CalendarClock className="h-4 w-4 text-ink-muted" /> Daily batches
          <span className="font-normal text-ink-muted">
            {data?.missing
              ? "· needs database update 068"
              : data
                ? `· ${active} active · $${data.spent.toFixed(2)} of $${data.cap} this month`
                : ""}
          </span>
        </span>
        <span className="text-[12px] text-action">{open ? "Hide" : "Show"}</span>
      </button>
      {open && data && (
        <div className="border-t border-rule px-4 py-3 space-y-3 text-[13px]">
          {data.missing ? (
            <p className="text-ink">Run <span className="font-mono">db/migrations/068_automation.sql</span> in Supabase, then reload.</p>
          ) : (
            <>
              <p className="text-[12px] text-ink-muted">
                Each weekday from 6:00 New York time, the next row runs as a {data.limit}-lead batch (about ${data.perBatch.toFixed(2)} each) and its emails
                start by themselves 24 hours after it finishes. No more run once this month&rsquo;s ${data.cap} is reached.
                {data.next ? ` Next: ${data.next.niche} / ${data.next.city}.` : " Add a row to start."}
              </p>
              {data.rows.length > 0 && (
                <ul className="divide-y divide-rule rounded-md border border-rule">
                  {data.rows.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className={r.active ? "text-ink" : "text-ink-subtle line-through"}>
                        {r.niche} / {r.city} <span className="text-ink-subtle uppercase">{r.country_code}</span>
                      </span>
                      <span className="flex items-center gap-2 text-[12px] text-ink-muted">
                        {r.last_run_at ? (
                          r.last_batch_id ? (
                            <Link href={`/batches/${r.last_batch_id}`} className="hover:underline">last ran {new Date(r.last_run_at).toLocaleDateString()}</Link>
                          ) : (
                            `last ran ${new Date(r.last_run_at).toLocaleDateString()}`
                          )
                        ) : (
                          "not run yet"
                        )}
                        <button type="button" onClick={() => toggle(r)} title={r.active ? "Pause this row" : "Resume this row"} className="p-1 rounded hover:bg-surface-alt">
                          {r.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" onClick={() => remove(r)} title="Remove" className="p-1 rounded hover:bg-surface-alt">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <input className={INPUT} placeholder="Niche, e.g. plumber" value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })} aria-label="Niche" />
                <input className={INPUT} placeholder="City, e.g. Austin, TX" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} aria-label="City" />
                <input className={`${INPUT} w-16 uppercase`} maxLength={2} value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })} aria-label="Country (two letters)" />
                <Button size="sm" onClick={add} loading={busy} disabled={busy || form.niche.trim().length < 2 || form.city.trim().length < 2}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
