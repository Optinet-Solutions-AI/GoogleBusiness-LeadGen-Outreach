/**
 * calls/CallLogsClient.tsx — Outreach → Call logs: every AI call we placed, with filters; click one to listen (19 Nov 2026).
 *
 * Inputs:  /api/calls?agent=&result=&from=&to=&test=1&page=
 * Outputs: the filterable table + CallViewer for the clicked call
 * Used by: app/(dashboard)/call-logs/page.tsx
 *
 * Dumb client: rows arrive labelled (agent, result, recording message) from lib/calls/call-logs.ts.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";
import { cx } from "@/lib/cx";
import { CallViewer } from "./CallViewer";

interface Row {
  id: string;
  leadId: string;
  business: string;
  createdAt: string;
  phone: string | null;
  isTest: boolean;
  agent: string;
  result: string;
  durationSec: number | null;
  hasTranscript: boolean;
  recording: { kind: "ready" | "pending" | "none"; text: string };
}
interface Data {
  rows: Row[];
  total: number;
  agents: { id: string; name: string }[];
  pageSize: number;
}
interface Filters {
  agent: string;
  result: string;
  from: string;
  to: string;
  test: boolean;
}

const RESULTS = [
  ["", "Any result"],
  ["interested", "Interested"],
  ["not_interested", "Not interested"],
  ["callback", "Call back"],
  ["no_answer", "No answer / voicemail"],
  ["failed", "Failed"],
] as const;

const INPUT = "px-2.5 py-1.5 text-[13px] border border-rule-strong rounded-lg bg-surface focus:ring-2 focus:ring-action/20 focus:border-action outline-none";
const DOT = { ready: "bg-positive", pending: "bg-warning", none: "bg-rule-strong" } as const;

function length(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function CallLogsClient() {
  const [filters, setFilters] = useState<Filters>({ agent: "", result: "", from: "", to: "", test: false });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams();
    if (filters.agent) q.set("agent", filters.agent);
    if (filters.result) q.set("result", filters.result);
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    if (filters.test) q.set("test", "1");
    q.set("page", String(page));
    const r = await fetchJson<Data>(`/api/calls?${q}`);
    setLoading(false);
    if (r.success) setData(r.data);
    else toast.error(r.error, { title: "Couldn't load call logs" });
  }, [filters, page]);
  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className={INPUT} value={filters.agent} onChange={(e) => set("agent", e.target.value)} aria-label="Voice agent">
          <option value="">Any voice agent</option>
          <option value="default">Voizo default</option>
          {data?.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select className={INPUT} value={filters.result} onChange={(e) => set("result", e.target.value)} aria-label="Result">
          {RESULTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[12px] text-ink-muted">
          From <input type="date" className={INPUT} value={filters.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-ink-muted">
          To <input type="date" className={INPUT} value={filters.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-ink">
          <input type="checkbox" checked={filters.test} onChange={(e) => set("test", e.target.checked)} /> Test numbers only
        </label>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
      </div>

      <div className="overflow-x-auto rounded-lg border border-rule">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Voice agent</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Length</th>
              <th className="px-3 py-2">Recording</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id} onClick={() => setOpen(r.id)} className="cursor-pointer border-t border-rule hover:bg-surface-alt">
                <td className="whitespace-nowrap px-3 py-2 mono-num">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <Link href={`/leads/${r.leadId}`} onClick={(e) => e.stopPropagation()} className="text-action hover:underline">
                    {r.business}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 mono-num">
                  {r.phone ?? "—"}
                  {r.isTest && <span className="ml-1.5 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning">test</span>}
                </td>
                <td className="px-3 py-2">{r.agent}</td>
                <td className="px-3 py-2">{r.result}</td>
                <td className="px-3 py-2 mono-num">{length(r.durationSec)}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5" title={r.recording.text || "Recording saved"}>
                    <span className={cx("h-2 w-2 rounded-full", DOT[r.recording.kind])} />
                    <span className="text-[12px] text-ink-muted">{r.recording.kind === "ready" ? "Listen" : r.recording.kind === "pending" ? "Coming" : "None"}</span>
                  </span>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[13px] text-ink-muted">
                  No AI calls match. Calls placed with Call with AI show up here after they end.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-ink-muted">
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
            Previous
          </Button>
          Page {page} of {pages}
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
            Next
          </Button>
        </div>
      )}

      {open && <CallViewer callId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
