"use client";

/**
 * ReelsStrip.tsx — Reels for the month: make one from approved posts, watch it render, play / download / delete.
 *
 * Inputs:  clientId, month, approved count (to enable the button)
 * Outputs: GET/POST /api/clients/:id/reels, GET/DELETE /api/clients/:id/reels/:rid (polls while rendering)
 * Used by: PostsTab
 */
import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Download, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { cx } from "@/lib/cx";
import { REEL_DEFAULT_SLIDE_SEC, REEL_MAX_SLIDES, REEL_MIN_SLIDES, reelFileName } from "@/lib/creatives/video/reel-plan";
import type { VideoRow } from "@/lib/creatives/video/videos";

type Eligible = { id: string; title: string | null; slot_date: string | null };
const FIELD = "w-full border border-rule rounded px-2 py-1.5 text-[12.5px] text-ink bg-surface outline-none focus:border-ink";

function MakeReelModal({ clientId, month, eligible, onClose, onQueued }: { clientId: string; month: string; eligible: Eligible[]; onClose: () => void; onQueued: () => void }) {
  const [picked, setPicked] = useState<string[]>(eligible.slice(0, REEL_MAX_SLIDES).map((e) => e.id));
  const [title, setTitle] = useState("");
  const [slideSec, setSlideSec] = useState(REEL_DEFAULT_SLIDE_SEC);
  const [busy, setBusy] = useState(false);
  const seconds = picked.length ? (picked.length * slideSec - (picked.length - 1) * 0.5 + 0.5 + (title.trim() ? 2 : 0)).toFixed(1) : "0";
  const ok = picked.length >= REEL_MIN_SLIDES && picked.length <= REEL_MAX_SLIDES;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const res = await fetchJson<{ id: string }>(`/api/clients/${clientId}/reels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ month, creative_ids: picked, slide_sec: slideSec, title: title.trim() }),
    });
    setBusy(false);
    if (!res.success) return toast.error(res.error, { title: "Could not start the Reel" });
    toast.success("Reel queued — it takes a minute or two");
    onQueued();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Make a Reel">
      <form onSubmit={submit} className="bg-surface border border-rule rounded-lg w-full max-w-md p-5 space-y-3">
        <h3 className="text-[13px] font-semibold text-ink">Make a Reel</h3>
        <p className="text-[11.5px] text-ink-muted">Approved posts with a 9:16 frame, in date order. Untick any you want to leave out ({REEL_MIN_SLIDES}–{REEL_MAX_SLIDES}).</p>
        <div className="max-h-56 overflow-y-auto border border-rule rounded divide-y divide-rule">
          {eligible.map((c) => (
            <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={picked.includes(c.id)}
                onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
              />
              <span className="mono-num text-ink-subtle text-[11px]">{c.slot_date?.slice(5) ?? "—"}</span>
              <span className="truncate">{c.title ?? "Untitled"}</span>
            </label>
          ))}
        </div>
        <input id="reel-title" className={FIELD} placeholder="Opening title (optional, e.g. the business name)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          Seconds per post
          <input id="reel-slide-sec" type="number" min={1.5} max={8} step={0.5} value={slideSec} onChange={(e) => setSlideSec(Number(e.target.value) || REEL_DEFAULT_SLIDE_SEC)} className="w-20 border border-rule rounded px-2 py-1 text-[12.5px] bg-surface" />
          <span className="text-ink-muted">≈ {seconds}s total · 1080×1920 · free</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" loading={busy} disabled={!ok}>Render Reel</Button>
        </div>
      </form>
    </div>
  );
}

export function ReelsStrip({ clientId, month }: { clientId: string; month: string }) {
  const [reels, setReels] = useState<VideoRow[] | null>(null);
  const [eligible, setEligible] = useState<Eligible[]>([]);
  const [modal, setModal] = useState(false);

  const load = useCallback(async () => {
    const r = await fetchJson<{ reels: VideoRow[]; eligible: Eligible[] }>(`/api/clients/${clientId}/reels?month=${month}`);
    if (r.success) {
      setReels(r.data.reels);
      setEligible(r.data.eligible);
    } else setReels([]);
  }, [clientId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is rendering.
  const busy = (reels ?? []).some((r) => r.status === "queued" || r.status === "rendering");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, load]);

  async function remove(id: string) {
    const r = await fetchJson<unknown>(`/api/clients/${clientId}/reels/${id}`, { method: "DELETE" });
    if (!r.success) return toast.error(r.error);
    setReels((cur) => (cur ?? []).filter((x) => x.id !== id));
  }

  return (
    <div className="bg-surface border border-rule rounded-lg px-5 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle font-mono"><Clapperboard className="h-3.5 w-3.5" /> Reels</span>
        <span className="text-[12px] text-ink-muted">{eligible.length} approved post{eligible.length === 1 ? "" : "s"} with a 9:16 frame</span>
        <div className="ml-auto">
          <Button size="sm" variant="secondary" disabled={eligible.length < REEL_MIN_SLIDES} title={eligible.length < REEL_MIN_SLIDES ? `Approve at least ${REEL_MIN_SLIDES} posts first` : undefined} onClick={() => setModal(true)}>
            <Clapperboard size={13} aria-hidden /> Make a Reel
          </Button>
        </div>
      </div>
      {reels === null ? (
        <div className="text-[12px] text-ink-muted"><Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" />Loading…</div>
      ) : reels.length === 0 ? (
        <p className="text-[12px] text-ink-subtle">No Reels yet. A Reel strings the month&apos;s approved posts into one vertical video — free, about a minute to render.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {reels.map((r) => (
            <li key={r.id} className={cx("w-[150px] rounded border border-rule bg-surface-alt p-2 text-[11.5px] space-y-1.5", r.status === "failed" && "border-urgent/40")}>
              {r.status === "ready" && r.public_url ? (
                <video src={r.public_url} controls preload="metadata" className="w-full aspect-[9/16] rounded bg-black" />
              ) : (
                <div className="w-full aspect-[9/16] rounded bg-ink/5 flex items-center justify-center text-ink-muted">
                  {r.status === "failed" ? <AlertTriangle className="h-5 w-5 text-urgent" /> : <Loader2 className="h-5 w-5 animate-spin" />}
                </div>
              )}
              <div className="flex items-center justify-between gap-1">
                <span className={cx("capitalize", r.status === "ready" ? "text-positive" : r.status === "failed" ? "text-urgent" : "text-ink-muted")}>
                  {r.status}{r.duration_sec ? ` · ${Math.round(r.duration_sec)}s` : ""}
                </span>
                <span className="flex items-center gap-1">
                  {r.status === "ready" && r.public_url && (
                    <a href={r.public_url} download={reelFileName(r.month, r.creative_ids.length)} className="text-action hover:underline" title="Download MP4"><Download className="h-3.5 w-3.5" /></a>
                  )}
                  <button type="button" onClick={() => remove(r.id)} className="text-ink-subtle hover:text-urgent" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </span>
              </div>
              {r.status === "failed" && r.last_error && <p className="text-urgent line-clamp-3" title={r.last_error}>{r.last_error}</p>}
            </li>
          ))}
        </ul>
      )}
      {modal && <MakeReelModal clientId={clientId} month={month} eligible={eligible} onClose={() => setModal(false)} onQueued={load} />}
    </div>
  );
}
