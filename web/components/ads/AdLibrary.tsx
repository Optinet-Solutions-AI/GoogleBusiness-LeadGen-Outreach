"use client";

/**
 * ads/AdLibrary.tsx — the Ad Library UI: pull modal, pull status strip, filters, ad grid, ad drawer with "make our version".
 *
 * Inputs:  ads, pulls, clients (server-loaded), current filters, price per ad, max per pull
 * Outputs: POST /api/ads/pulls, PATCH/DELETE /api/ads/:id, POST /api/ads/:id/remake; router.refresh() to reload
 * Used by: app/(dashboard)/ads/page.tsx
 *
 * Dumb by design: pricing / URL rules live in lib/services/apify-ads.ts and lib/ads/*.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Download, ExternalLink, Image as ImageIcon, Loader2, Search, Star, Trash2, Video, WandSparkles, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { relativeTime } from "@/lib/format";
import { cx } from "@/lib/cx";
import { COUNTRIES } from "@/lib/data/cities";
import { PLATFORMS, type Platform } from "@/lib/creatives/types";
import type { AdRow } from "@/lib/ads/library";
import type { PullRow } from "@/lib/ads/pulls";
import type { AdAnalysis } from "@/lib/services/gemini-ads";

type ClientOpt = { id: string; name: string };
type Filters = { media?: "video" | "image"; saved: boolean; q?: string; pull?: string };

const FIELD = "w-full border border-rule rounded px-2 py-1.5 text-[12.5px] text-ink bg-surface outline-none focus:border-ink";

function filterUrl(f: Filters): string {
  const p = new URLSearchParams();
  if (f.media) p.set("media", f.media);
  if (f.saved) p.set("saved", "1");
  if (f.q) p.set("q", f.q);
  if (f.pull) p.set("pull", f.pull);
  const s = p.toString();
  return s ? `/ads?${s}` : "/ads";
}

function thumbOf(ad: AdRow): string | null {
  return ad.stored_thumbnail_url ?? ad.thumbnail_url ?? ad.stored_image_urls[0] ?? ad.image_urls[0] ?? null;
}
function videoOf(ad: AdRow): string | null {
  return ad.stored_video_url ?? ad.video_url;
}
function daysRunning(ad: AdRow): number | null {
  if (!ad.started_at) return null;
  const end = ad.is_active ? Date.now() : ad.ended_at ? Date.parse(ad.ended_at) : Date.now();
  return Math.max(0, Math.round((end - Date.parse(ad.started_at)) / 86_400_000));
}

// ---------- Pull modal ----------

function PullModal({ usdPerAd, maxPerPull, clients, onClose }: { usdPerAd: number; maxPerPull: number; clients: ClientOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "keyword">("keyword");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("us");
  const [media, setMedia] = useState<"all" | "video" | "image">("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [limit, setLimit] = useState(50);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const estimate = (Math.min(Math.max(1, limit), maxPerPull) * usdPerAd).toFixed(2);
  const ok = mode === "url" ? /facebook\.com/.test(url) : query.trim().length > 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const res = await fetchJson<{ id: string; estimate_usd: number }>("/api/ads/pulls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_url: mode === "url" ? url.trim() : null,
        query: mode === "keyword" ? query.trim() : null,
        country,
        media_type: media,
        active_only: activeOnly,
        max_results: Math.min(Math.max(1, limit), maxPerPull),
        client_id: clientId || null,
      }),
    });
    setBusy(false);
    if (!res.success) return toast.error(res.error, { title: "Could not start the pull" });
    toast.success(`Pulling up to ${limit} ads (≈ $${estimate}) — 1–3 minutes`);
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Pull ads">
      <form onSubmit={submit} className="bg-surface border border-rule rounded-lg w-full max-w-md p-5 space-y-3">
        <h3 className="text-[13px] font-semibold text-ink">Pull competitor ads</h3>
        <div className="flex gap-1 text-[12px]">
          {(["keyword", "url"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={cx("px-2.5 py-1 rounded border", mode === m ? "border-ink bg-ink text-surface" : "border-rule text-ink-muted")}>
              {m === "keyword" ? "Keyword" : "Ad Library URL"}
            </button>
          ))}
        </div>
        {mode === "url" ? (
          <input id="pull-url" className={FIELD} placeholder="https://www.facebook.com/ads/library/?…  (a brand's page in the library, or a search)" value={url} onChange={(e) => setUrl(e.target.value)} />
        ) : (
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <input id="pull-query" className={FIELD} placeholder="e.g. flooring store, dentist, gym" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select id="pull-country" className={FIELD} value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-[12.5px]">
          <select id="pull-media" className={FIELD} value={media} onChange={(e) => setMedia(e.target.value as typeof media)} aria-label="Media">
            <option value="all">Video + image</option>
            <option value="video">Video only</option>
            <option value="image">Image only</option>
          </select>
          <label className="flex items-center gap-1.5 text-ink"><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Running now</label>
          <label className="flex items-center gap-1.5 text-ink">Max <input id="pull-limit" type="number" min={1} max={maxPerPull} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 50)} className="w-16 border border-rule rounded px-1.5 py-1 bg-surface" /></label>
        </div>
        {clients.length > 0 && (
          <select id="pull-client" className={FIELD} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="For client">
            <option value="">Not for a specific client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>For {c.name}</option>)}
          </select>
        )}
        <p className="text-[11.5px] text-ink-muted">Paid: about <b className="text-ink">${estimate}</b> for up to {limit} ads (${usdPerAd.toFixed(4)} each). Video-only / image-only filtering happens after the pull, so the charge is for what Meta returns.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" loading={busy} disabled={!ok}>Pull ads (≈ ${estimate})</Button>
        </div>
      </form>
    </div>
  );
}

// ---------- Ad drawer ----------

function AdDrawer({ ad, clients, onClose, onChange, onDelete }: { ad: AdRow; clients: ClientOpt[]; onClose: () => void; onChange: (ad: AdRow) => void; onDelete: () => void }) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram", "facebook"]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ creative_id: string; analysis: AdAnalysis } | null>(null);
  const [notes, setNotes] = useState(ad.notes ?? "");
  const [tags, setTags] = useState(ad.tags.join(", "));
  const video = videoOf(ad);
  const images = ad.stored_image_urls.length ? ad.stored_image_urls : ad.image_urls;
  const analysis = result?.analysis ?? ad.analysis;
  const lastRemake = result ? { client_id: clientId, creative_id: result.creative_id } : ad.remakes[ad.remakes.length - 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label);
    const r = await fetchJson<{ ad: AdRow }>(`/api/ads/${ad.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!r.success) return toast.error(r.error, { title: `Could not ${label}` });
    onChange(r.data.ad);
    toast.success(label === "save" ? (r.data.ad.saved ? "Saved — media copied" : "Unsaved") : `${label} saved`);
  }
  async function remake() {
    if (!clientId || !platforms.length) return;
    setBusy("remake");
    const r = await fetchJson<{ creative_id: string; analysis: AdAnalysis; cost_usd: number }>(`/api/ads/${ad.id}/remake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, platforms }),
    });
    setBusy(null);
    if (!r.success) return toast.error(r.error, { title: "Could not make our version" });
    setResult({ creative_id: r.data.creative_id, analysis: r.data.analysis });
    onChange({ ...ad, analysis: r.data.analysis, remakes: [...ad.remakes, { client_id: clientId, creative_id: r.data.creative_id, at: new Date().toISOString() }] });
    toast.success("Draft post created — open it in Creative Studio to generate");
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/20" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label={ad.page_name ?? "Ad"} className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-rule bg-surface shadow-hero">
        <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-semibold text-ink">{ad.page_name ?? "Unknown advertiser"}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
              <span className="capitalize">{ad.media_kind}</span>
              {ad.page_category && <span>· {ad.page_category}</span>}
              <span>· {ad.is_active ? "running" : "stopped"}{daysRunning(ad) != null ? `, ${daysRunning(ad)} days` : ""}</span>
              <span>· {ad.platforms.join(", ") || "—"}</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => patch({ saved: !ad.saved }, "save")} disabled={busy === "save"} className={cx("rounded p-1.5", ad.saved ? "text-warning" : "text-ink-muted hover:text-ink")} title={ad.saved ? "Unsave" : "Save (copies media)"}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" fill={ad.saved ? "currentColor" : "none"} />}
            </button>
            <button type="button" onClick={onDelete} className="rounded p-1.5 text-ink-muted hover:text-urgent" title="Delete from library"><Trash2 className="h-4 w-4" /></button>
            <button type="button" onClick={onClose} className="rounded p-1.5 text-ink-muted hover:text-ink" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {video ? (
            <video src={video} poster={thumbOf(ad) ?? undefined} controls preload="metadata" className="w-full max-h-[420px] rounded bg-black" />
          ) : images.length ? (
            <div className={cx("grid gap-2", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {images.slice(0, 6).map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt="" className="w-full rounded border border-rule object-cover" />
              ))}
            </div>
          ) : (
            <div className="rounded border border-rule bg-surface-alt p-6 text-center text-[12px] text-ink-muted">No media captured for this ad</div>
          )}
          {!ad.saved && (video || images.length > 0) && (
            <p className="text-[11.5px] text-warning"><AlertTriangle className="inline h-3 w-3 mr-1" />Meta&apos;s media links expire in a few days. Save the ad to keep a copy.</p>
          )}

          <section className="space-y-1.5 text-[13px]">
            {ad.title && <div className="font-semibold text-ink">{ad.title}</div>}
            {ad.body && <p className="whitespace-pre-wrap text-ink">{ad.body}</p>}
            {ad.link_description && <p className="text-ink-muted">{ad.link_description}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              {ad.cta_text && <span className="rounded bg-surface-alt px-2 py-0.5 text-ink">CTA: {ad.cta_text}</span>}
              {ad.link_url && <a href={ad.link_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-action hover:underline">Landing page <ExternalLink className="h-3 w-3" /></a>}
              {ad.ad_library_url && <a href={ad.ad_library_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-action hover:underline">In Ad Library <ExternalLink className="h-3 w-3" /></a>}
              {video && <a href={video} download className="inline-flex items-center gap-1 text-action hover:underline">Video <Download className="h-3 w-3" /></a>}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <input id="ad-tags" className={FIELD} placeholder="tags: hook, before-after" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => tags !== ad.tags.join(", ") && patch({ tags: tags.split(",") }, "tags")} />
            <input id="ad-notes" className={FIELD} placeholder="note" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (ad.notes ?? "") && patch({ notes: notes || null }, "note")} />
          </section>

          {/* Make our version */}
          <section className="rounded-lg border border-rule bg-surface-alt/60 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle font-mono"><WandSparkles className="h-3.5 w-3.5" /> Make our version</div>
            {clients.length === 0 ? (
              <p className="text-[12px] text-ink-muted">Make a client (with a Brand Brain) first.</p>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                  <select id="remake-client" className={FIELD} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="flex gap-2 text-[12px] text-ink">
                    {PLATFORMS.map((p) => (
                      <label key={p} className="flex items-center gap-1 capitalize"><input type="checkbox" checked={platforms.includes(p)} onChange={(e) => setPlatforms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))} />{p}</label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11.5px] text-ink-muted">Gemini writes a brief + video script from the client&apos;s Brand Brain. Nothing of the competitor&apos;s is reused. Fractions of a cent.</p>
                  <Button size="sm" loading={busy === "remake"} disabled={!clientId || !platforms.length} onClick={remake}>Make our version</Button>
                </div>
              </>
            )}
            {lastRemake && (
              <Link href={`/clients/${lastRemake.client_id}?tab=posts&creative=${lastRemake.creative_id}`} className="inline-flex items-center gap-1 text-[12.5px] text-action hover:underline">
                Open the draft post in Creative Studio <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </section>

          {analysis && (
            <section className="space-y-2 text-[12.5px]">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle font-mono">Why it works</div>
              <p className="text-ink">{analysis.why_it_works}</p>
              <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 text-ink-muted">
                <dt>Hook</dt><dd className="text-ink">{analysis.hook}</dd>
                <dt>Angle</dt><dd className="text-ink">{analysis.angle}</dd>
                <dt>Tone</dt><dd className="text-ink">{analysis.tone}</dd>
                <dt>Offer</dt><dd className="text-ink">{analysis.offer_shape}</dd>
                <dt>Structure</dt><dd className="text-ink">{analysis.structure.join(" → ")}</dd>
              </dl>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle font-mono pt-1">Our brief</div>
              <p className="text-ink whitespace-pre-wrap">{analysis.our_brief}</p>
              {analysis.video_script.length > 0 && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle font-mono pt-1">Video script ({analysis.video_script.reduce((s, x) => s + x.seconds, 0)}s)</div>
                  <ol className="space-y-1.5">
                    {analysis.video_script.map((s) => (
                      <li key={s.scene} className="rounded border border-rule p-2">
                        <div className="flex justify-between text-[11px] text-ink-muted"><span>Scene {s.scene}</span><span className="mono-num">{s.seconds}s</span></div>
                        <div className="text-ink"><b>On screen:</b> {s.on_screen_text}</div>
                        <div className="text-ink-muted"><b>Visual:</b> {s.visual}</div>
                        <div className="text-ink-muted"><b>Voice:</b> {s.voice_over}</div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {analysis.cautions.length > 0 && (
                <ul className="text-warning list-disc pl-4">{analysis.cautions.map((c) => <li key={c}>{c}</li>)}</ul>
              )}
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------- Library ----------

export function AdLibrary({ ads: initial, pulls, clients, filters, usdPerAd, maxPerPull }: { ads: AdRow[]; pulls: PullRow[]; clients: ClientOpt[]; filters: Filters; usdPerAd: number; maxPerPull: number }) {
  const router = useRouter();
  const [ads, setAds] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  const [q, setQ] = useState(filters.q ?? "");
  useEffect(() => setAds(initial), [initial]);

  const live = useMemo(() => pulls.filter((p) => p.status === "queued" || (p.status === "running" && p.started_at && Date.now() - Date.parse(p.started_at) < 20 * 60_000)), [pulls]);
  useEffect(() => {
    if (!live.length) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [live.length, router]);

  const open = openId ? ads.find((a) => a.id === openId) ?? null : null;
  const go = (patch: Partial<Filters>) => router.push(filterUrl({ ...filters, ...patch }));

  async function toggleSave(ad: AdRow) {
    const r = await fetchJson<{ ad: AdRow }>(`/api/ads/${ad.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ saved: !ad.saved }) });
    if (!r.success) return toast.error(r.error);
    setAds((cur) => cur.map((a) => (a.id === ad.id ? r.data.ad : a)));
  }
  async function remove(id: string) {
    const r = await fetchJson<unknown>(`/api/ads/${id}`, { method: "DELETE" });
    if (!r.success) return toast.error(r.error);
    setAds((cur) => cur.filter((a) => a.id !== id));
    setOpenId(null);
  }

  return (
    <div className="space-y-4">
      {/* Pull strip + filters */}
      <div className="flex flex-wrap items-center gap-2">
        {live.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface px-3 py-1 text-[12px] text-ink-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Pulling {p.query ?? "from URL"} · up to {p.max_results}
          </span>
        ))}
        {pulls.filter((p) => p.status === "failed").slice(0, 1).map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-urgent-soft px-3 py-1 text-[12px] text-urgent" title={p.last_error ?? ""}>
            <AlertTriangle className="h-3 w-3" /> Last pull failed: {(p.last_error ?? "").slice(0, 60)}
          </span>
        ))}
        <span className="flex-1" />
        <form onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() || undefined }); }} className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-subtle" />
          <input id="ads-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search page or text…" className="h-9 w-56 rounded-lg border border-rule-strong bg-surface pl-8 pr-2 text-[13px] text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/20" />
        </form>
        <SelectMenu label="Media" value={filters.media ?? ""} options={[{ value: "", label: "All" }, { value: "video", label: "Video" }, { value: "image", label: "Image" }]} onChange={(v) => go({ media: (v || undefined) as Filters["media"] })} />
        <SelectMenu label="Show" value={filters.saved ? "saved" : ""} options={[{ value: "", label: "Everything" }, { value: "saved", label: "Saved only" }]} onChange={(v) => go({ saved: v === "saved" })} />
        {pulls.length > 0 && (
          <SelectMenu label="Pull" value={filters.pull ?? ""} options={[{ value: "", label: "Any" }, ...pulls.slice(0, 15).map((p) => ({ value: p.id, label: `${p.query ?? "URL"} · ${p.found} · ${relativeTime(p.created_at)}` }))]} onChange={(v) => go({ pull: v || undefined })} align="right" />
        )}
        <Button size="sm" onClick={() => setPullOpen(true)}><Clapperboard size={13} aria-hidden /> Pull ads</Button>
      </div>

      {ads.length === 0 ? (
        <div className="bg-surface border border-rule rounded-lg p-12 text-center text-[13px] text-ink-muted">
          {pulls.length === 0 ? "No ads yet. Pull a competitor's ads from the Meta Ad Library to start the library." : "No ads match these filters."}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {ads.map((ad) => {
            const thumb = thumbOf(ad);
            const days = daysRunning(ad);
            return (
              <div key={ad.id} role="button" tabIndex={0} onClick={() => setOpenId(ad.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(ad.id)} className="group cursor-pointer rounded-lg border border-rule bg-surface overflow-hidden hover:border-rule-strong transition">
                <div className="relative aspect-[4/5] bg-surface-alt">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-subtle">{ad.media_kind === "video" ? <Video className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />}</div>
                  )}
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    {ad.media_kind === "video" ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />} {ad.media_kind}
                  </span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); void toggleSave(ad); }} className={cx("absolute right-2 top-2 rounded bg-black/60 p-1", ad.saved ? "text-warning" : "text-white/80 hover:text-white")} title={ad.saved ? "Saved" : "Save"}>
                    <Star className="h-3.5 w-3.5" fill={ad.saved ? "currentColor" : "none"} />
                  </button>
                  {ad.remakes.length > 0 && <span className="absolute bottom-2 left-2 rounded bg-positive px-1.5 py-0.5 text-[10px] font-semibold text-white">our version ×{ad.remakes.length}</span>}
                </div>
                <div className="p-2 space-y-0.5">
                  <div className="truncate text-[12.5px] font-semibold text-ink">{ad.page_name ?? "Unknown"}</div>
                  <div className="line-clamp-2 text-[11.5px] text-ink-muted">{ad.title ?? ad.body ?? "—"}</div>
                  <div className="flex items-center gap-1.5 text-[10.5px] text-ink-subtle">
                    <span className={ad.is_active ? "text-positive" : ""}>{ad.is_active ? "running" : "stopped"}</span>
                    {days != null && <span>· {days}d</span>}
                    {ad.cta_text && <span className="truncate">· {ad.cta_text}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pullOpen && <PullModal usdPerAd={usdPerAd} maxPerPull={maxPerPull} clients={clients} onClose={() => setPullOpen(false)} />}
      {open && <AdDrawer ad={open} clients={clients} onClose={() => setOpenId(null)} onChange={(a) => setAds((cur) => cur.map((x) => (x.id === a.id ? a : x)))} onDelete={() => remove(open.id)} />}
    </div>
  );
}
