"use client";

/**
 * CreativeView.tsx — one post's detail: preview, captions, template inputs, grounding, regenerate / re-render / save, review, versions.
 *
 * Inputs:  clientId, creative, versions (newest first), reviews, assets (picker), templates (registry), imageUsd
 * Outputs: GET …/creatives/:cid (poll while rendering), POST …/versions, …/regenerate, …/review; toasts; router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Posts tab, ?creative=<id>)
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { AssetPicker } from "@/components/clients/AssetPicker";
import { CaptionEditor } from "@/components/clients/CaptionEditor";
import { ReviewBar } from "@/components/clients/ReviewBar";
import { VersionStrip } from "@/components/clients/VersionStrip";
import { checkCaptionLimits } from "@/lib/creatives/limits";
import { isRenderingStale } from "@/lib/creatives/state";
import type { TEMPLATES } from "@/lib/creatives/templates/registry";
import { ASPECTS, type Aspect, type CreativeCopy, type CreativeInputs, type PlatformCopy } from "@/lib/creatives/types";
import type { CreativeRow, ReviewRow, VersionRow } from "@/lib/creatives/creatives";
import type { AssetRow } from "@/lib/clients/assets";

type Asset = Pick<AssetRow, "id" | "kind" | "status" | "public_url" | "alt">;
const FIELD = "w-full border border-rule rounded px-2 py-1.5 text-[12.5px] text-ink bg-surface outline-none focus:border-ink disabled:opacity-60";
const LABEL = "block text-[11.5px] font-medium text-ink-muted mb-1";
const COLOR_KEYS = ["primary", "accent", "background", "text"] as const;
const APPROVED_WARNING = "This version is approved. Saving creates a new draft and removes the approval. Continue?";

type FormInputs = Pick<
  CreativeInputs,
  "headline" | "subhead" | "cta_text" | "body" | "slides" | "colors" | "logo_asset_id" | "photo_asset_ids" | "background_asset_id" | "background_prompt"
>;

function toForm(v: VersionRow): { inputs: FormInputs; copy: CreativeCopy } {
  const i = v.inputs ?? {};
  return {
    inputs: {
      headline: i.headline ?? "",
      subhead: i.subhead ?? "",
      cta_text: i.cta_text ?? "",
      body: i.body ?? "",
      slides: i.slides ?? [],
      colors: i.colors ?? { primary: "#000000", accent: "#000000", background: "#ffffff", text: "#000000" },
      logo_asset_id: i.logo_asset_id ?? null,
      photo_asset_ids: i.photo_asset_ids ?? [],
      background_asset_id: i.background_asset_id ?? null,
      background_prompt: i.background_prompt ?? null,
    },
    copy: v.copy ?? {},
  };
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; error: string }> {
  try {
    const res = await fetch(url, init);
    const j = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    return { ok: res.ok && j?.success !== false, status: res.status, error: j?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: `Network error: ${String(e)}` };
  }
}

const hex = (c: string | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000");

function Preview({ version, rendering: busy }: { version: VersionRow; rendering: boolean }) {
  const [aspect, setAspect] = useState<Aspect>("1:1");
  const [slide, setSlide] = useState(1);
  const renders = version.renders ?? [];
  const slides = Array.from(new Set(renders.filter((r) => r.aspect === aspect && r.slide !== null).map((r) => r.slide as number))).sort(
    (a, b) => a - b,
  );
  const shown = renders.find((r) => r.aspect === aspect && (r.slide === null || r.slide === (slides.includes(slide) ? slide : slides[0] ?? null)));
  const rendering = busy && !renders.length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {ASPECTS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAspect(a)}
            aria-pressed={a === aspect}
            className={`px-2 py-1 rounded border text-[11.5px] ${a === aspect ? "border-ink bg-surface-alt text-ink" : "border-rule text-ink-muted hover:border-ink"}`}
          >
            {a}
          </button>
        ))}
        {slides.length > 1 && <span className="mx-1 w-px bg-rule" />}
        {slides.length > 1 &&
          slides.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlide(s)}
              aria-pressed={s === (slides.includes(slide) ? slide : slides[0])}
              className={`px-2 py-1 rounded border text-[11.5px] ${
                s === (slides.includes(slide) ? slide : slides[0]) ? "border-ink bg-surface-alt text-ink" : "border-rule text-ink-muted hover:border-ink"
              }`}
            >
              Slide {s}
            </button>
          ))}
      </div>
      <div className="bg-surface-alt border border-rule rounded-lg flex items-center justify-center min-h-[240px] p-2">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown.public_url} alt={`${aspect} preview`} className="max-h-[560px] max-w-full object-contain" />
        ) : rendering ? (
          <p className="flex items-center gap-2 text-[13px] text-ink-muted">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Rendering…
          </p>
        ) : (
          <p className="text-[12.5px] text-ink-muted">No render for {aspect} yet.</p>
        )}
      </div>
    </div>
  );
}

export function CreativeView({
  clientId,
  creative,
  versions,
  reviews,
  assets,
  templates,
  imageUsd,
}: {
  clientId: string;
  creative: CreativeRow;
  versions: VersionRow[];
  reviews: ReviewRow[];
  assets: Asset[];
  templates: typeof TEMPLATES;
  imageUsd: number;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<number | null>(null);
  const latest = versions[0] ?? null;
  const shown = (sel !== null ? versions.find((v) => v.version === sel) : null) ?? latest;
  // a `rendering` claim older than the stale threshold belongs to a run that died: treat the post as idle
  const [now, setNow] = useState(() => Date.now());
  const stalled = isRenderingStale(creative, now);
  const rendering = creative.status === "rendering" && !stalled;
  const base = `/api/clients/${clientId}/creatives/${creative.id}`;

  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(async () => {
      setNow(Date.now());
      try {
        const res = await fetch(base);
        const j = (await res.json()) as { data?: { creative?: { status?: string } } };
        const status = j.data?.creative?.status;
        if (res.ok && status && status !== "rendering") router.refresh();
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [rendering, base, router]);

  if (!shown || !latest) {
    return <div className="bg-surface border border-rule rounded-lg p-12 text-center text-[13px] text-ink-muted">This post has no versions yet.</div>;
  }
  const isLatest = shown.id === latest.id;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{creative.title ?? "Untitled post"}</h2>
        <p className="text-[12px] text-ink-muted capitalize">
          {templates[creative.template_key].label} · {creative.kind} · {creative.platforms.join(" · ")}
          {creative.slot_date ? ` · ${creative.slot_date}` : ""}
        </p>
      </div>
      {creative.status === "failed" && creative.last_error && (
        <p className="text-[12.5px] text-danger border border-danger rounded px-3 py-2">Last run failed: {creative.last_error}</p>
      )}
      {stalled && (
        <p className="text-[12.5px] text-warning border border-rule rounded px-3 py-2" role="status">
          Previous run stalled — resuming is possible: actions are unlocked. Re-render (free) before approving.
        </p>
      )}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <Preview version={shown} rendering={rendering} />
          <VersionStrip versions={versions} reviews={reviews} shown={shown.version} onSelect={(v) => setSel(v === latest.version ? null : v)} />
          {!isLatest && (
            <p className="text-[12px] text-ink-muted">
              Viewing v{shown.version} (read only).{" "}
              <button type="button" className="underline" onClick={() => setSel(null)}>
                Back to latest
              </button>
            </p>
          )}
        </div>
        <Editor
          key={shown.id}
          clientId={clientId}
          creative={creative}
          version={shown}
          readOnly={!isLatest}
          rendering={rendering}
          stalled={stalled}
          assets={assets}
          templates={templates}
          imageUsd={imageUsd}
          onSaved={() => {
            setSel(null);
            router.refresh();
          }}
        />
      </div>
    </div>
  );
}

function Editor({
  clientId,
  creative,
  version,
  readOnly,
  rendering,
  stalled,
  assets,
  templates,
  imageUsd,
  onSaved,
}: {
  clientId: string;
  creative: CreativeRow;
  version: VersionRow;
  readOnly: boolean;
  rendering: boolean;
  /** status is `rendering` but the claim is stale: actions unlocked, approve still needs a fresh render. */
  stalled: boolean;
  assets: Asset[];
  templates: typeof TEMPLATES;
  imageUsd: number;
  onSaved: () => void;
}) {
  const router = useRouter();
  const base = `/api/clients/${clientId}/creatives/${creative.id}`;
  const meta = templates[creative.template_key];
  const initial = useMemo(() => toForm(version), [version]);
  const [inputs, setInputs] = useState<FormInputs>(initial.inputs);
  const [copy, setCopy] = useState<CreativeCopy>(initial.copy);
  const [note, setNote] = useState("");
  const [bgOn, setBgOn] = useState(
    !!(initial.inputs.background_prompt !== null || initial.inputs.background_asset_id) || meta.defaultBackground,
  );
  const [busy, setBusy] = useState<string | null>(null);

  const fields = new Set<string>(meta.inputFields);
  const dirtyInputs = (Object.keys(inputs) as (keyof FormInputs)[]).filter(
    (k) => (fields.has(k) || (k === "slides" && creative.kind === "carousel")) && JSON.stringify(inputs[k]) !== JSON.stringify(initial.inputs[k]),
  );
  const dirtyCopy = creative.platforms.filter((p) => JSON.stringify(copy[p]) !== JSON.stringify(initial.copy[p]));
  const dirty = dirtyInputs.length > 0 || dirtyCopy.length > 0;
  const over = checkCaptionLimits(Object.fromEntries(creative.platforms.map((p) => [p, copy[p]]).filter(([, v]) => v)) as CreativeCopy);
  const approved = version.state === "approved";
  const locked = readOnly || rendering || busy !== null;

  const set = <K extends keyof FormInputs>(k: K, v: FormInputs[K]) => setInputs((cur) => ({ ...cur, [k]: v }));
  const text = (k: "headline" | "subhead" | "cta_text") => (
    <div key={k}>
      <label className={LABEL}>{k === "cta_text" ? "Call to action" : k === "headline" ? "Headline" : "Subhead"}</label>
      <input className={FIELD} value={inputs[k]} disabled={readOnly} onChange={(e) => set(k, e.target.value)} />
    </div>
  );

  async function run(label: string, url: string, body: unknown, confirmMsg: string | null, okMsg: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(label);
    try {
      const res = await call(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 409) return toast.error("Still rendering — try again in a moment");
      if (!res.ok) return toast.error(res.error);
      toast.success(okMsg);
      onSaved();
    } finally {
      setBusy(null);
    }
  }

  function save() {
    const patchInputs: Partial<FormInputs> = {};
    for (const k of dirtyInputs) (patchInputs as Record<string, unknown>)[k] = inputs[k];
    const patchCopy: CreativeCopy = {};
    for (const p of dirtyCopy) patchCopy[p] = copy[p];
    void run(
      "save",
      `${base}/versions`,
      { inputs: patchInputs, copy: patchCopy, note: note.trim() || null },
      approved ? APPROVED_WARNING : null,
      "Saved as a new version — rendering",
    );
  }

  const approvedPrefix = "This version is approved. This creates a new draft and removes the approval. ";
  const blockers = (version.grounding?.issues ?? []).filter((i) => !i.warning);
  const warnings = (version.grounding?.issues ?? []).filter((i) => i.warning);
  const saveReason = readOnly
    ? "Switch to the latest version to edit"
    : over.length
      ? `Over limit: ${over.map((o) => `${o.platform} ${o.reason}`).join("; ")}`
      : !dirty
        ? "No changes to save"
        : null;

  return (
    <div className="space-y-5">
      <section className="space-y-4">
        <h3 className="text-[12.5px] font-semibold text-ink">Captions</h3>
        {creative.platforms.map((p) => (
          <CaptionEditor
            key={p}
            platform={p}
            value={copy[p] ?? { caption: "", hashtags: [] }}
            disabled={readOnly}
            onChange={(next: PlatformCopy) => setCopy((cur) => ({ ...cur, [p]: next }))}
          />
        ))}
      </section>

      <section className="space-y-3">
        <h3 className="text-[12.5px] font-semibold text-ink">Template inputs</h3>
        {text("headline")}
        {fields.has("body") && (
          <div>
            <label className={LABEL}>Review text</label>
            <textarea className={FIELD} rows={3} value={inputs.body ?? ""} disabled={readOnly} onChange={(e) => set("body", e.target.value)} />
          </div>
        )}
        {text("subhead")}
        {text("cta_text")}
        {creative.kind === "carousel" && (
          <div className="space-y-2">
            <label className={LABEL}>Slides</label>
            {(inputs.slides ?? []).map((s, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2">
                <input
                  className={FIELD}
                  value={s.headline}
                  disabled={readOnly}
                  aria-label={`Slide ${idx + 1} headline`}
                  onChange={(e) => set("slides", (inputs.slides ?? []).map((x, j) => (j === idx ? { ...x, headline: e.target.value } : x)))}
                />
                <input
                  className={FIELD}
                  value={s.subhead}
                  disabled={readOnly}
                  aria-label={`Slide ${idx + 1} subhead`}
                  onChange={(e) => set("slides", (inputs.slides ?? []).map((x, j) => (j === idx ? { ...x, subhead: e.target.value } : x)))}
                />
              </div>
            ))}
          </div>
        )}
        {fields.has("photo_asset_ids") && (
          <div>
            <label className={LABEL}>Photo</label>
            <AssetPicker assets={assets} selected={inputs.photo_asset_ids} onChange={(ids) => !readOnly && set("photo_asset_ids", ids)} />
          </div>
        )}
        {fields.has("logo_asset_id") && (
          <div>
            <label className={LABEL}>Logo</label>
            <AssetPicker
              assets={assets}
              selected={inputs.logo_asset_id ? [inputs.logo_asset_id] : []}
              onChange={(ids) => !readOnly && set("logo_asset_id", ids.filter((i) => i !== inputs.logo_asset_id).pop() ?? null)}
            />
          </div>
        )}
        {fields.has("background_prompt") && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={bgOn}
                disabled={readOnly}
                onChange={(e) => {
                  setBgOn(e.target.checked);
                  if (!e.target.checked) setInputs((cur) => ({ ...cur, background_prompt: null, background_asset_id: null }));
                }}
              />
              AI background
            </label>
            {bgOn && (
              <input
                className={FIELD}
                placeholder="Describe the background"
                value={inputs.background_prompt ?? ""}
                disabled={readOnly}
                onChange={(e) => set("background_prompt", e.target.value || null)}
                aria-label="Background prompt"
              />
            )}
            {inputs.background_asset_id &&
              (() => {
                const bg = assets.find((a) => a.id === inputs.background_asset_id);
                return bg?.public_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bg.public_url} alt="Current background" className="h-14 rounded border border-rule" />
                ) : null;
              })()}
          </div>
        )}
        <div>
          <label className={LABEL}>Colours</label>
          <div className="flex gap-3">
            {COLOR_KEYS.map((k) => (
              <label key={k} className="text-[11px] text-ink-muted flex flex-col items-start gap-1 capitalize">
                {k}
                <input
                  type="color"
                  value={hex(inputs.colors[k])}
                  disabled={readOnly}
                  onChange={(e) => set("colors", { ...inputs.colors, [k]: e.target.value })}
                  className="h-8 w-12 border border-rule rounded bg-surface"
                />
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-[12.5px] font-semibold text-ink">Grounding</h3>
        {blockers.length === 0 && warnings.length === 0 && version.grounding?.ok ? (
          <p className="text-[12px] text-positive">All claims match the Brand Brain.</p>
        ) : (
          <ul className="space-y-1.5">
            {blockers.map((i, n) => (
              <li key={`b${n}`} className="flex gap-2 text-[12px] border border-danger rounded px-2 py-1.5 text-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  <strong className="capitalize">Blocker · {i.platform}:</strong> &ldquo;{i.text}&rdquo; — {i.reason}
                </span>
              </li>
            ))}
            {warnings.map((i, n) => (
              <li key={`w${n}`} className="flex gap-2 text-[12px] border border-rule rounded px-2 py-1.5 text-warning">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  <strong className="capitalize">Warning · {i.platform}:</strong> &ldquo;{i.text}&rdquo; — {i.reason}
                </span>
              </li>
            ))}
            {blockers.length === 0 && !version.grounding?.ok && <li className="text-[12px] text-danger">Grounding check failed.</li>}
          </ul>
        )}
      </section>

      {!readOnly && (
        <section className="space-y-2">
          <input className={FIELD} placeholder="Version note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Version note" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy === "save"} disabled={locked || !!saveReason} title={saveReason ?? "Free — re-renders locally"} onClick={save}>
              Save as new version
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "render"}
              disabled={locked || dirty}
              title={dirty ? "Save or discard your edits first" : "Free"}
              onClick={() =>
                run("render", `${base}/regenerate`, { what: "render" }, approved ? `${approvedPrefix}Continue?` : null, "Re-rendering")
              }
            >
              Re-render (free)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "copy"}
              disabled={locked || dirty}
              title={dirty ? "Save or discard your edits first" : undefined}
              onClick={() =>
                run(
                  "copy",
                  `${base}/regenerate`,
                  { what: "copy" },
                  `${approved ? approvedPrefix : ""}Regenerate the copy? Costs ≈ $0.003.`,
                  "Regenerating copy",
                )
              }
            >
              Regenerate copy (≈ $0.003)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === "background"}
              disabled={locked || dirty || !fields.has("background_prompt")}
              title={!fields.has("background_prompt") ? "This template has no AI background" : dirty ? "Save or discard your edits first" : undefined}
              onClick={() =>
                run(
                  "background",
                  `${base}/regenerate`,
                  { what: "background" },
                  `${approved ? approvedPrefix : ""}Generate a new background? Costs ≈ $${imageUsd}.`,
                  "Generating background",
                )
              }
            >
              New background (≈ ${imageUsd})
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => {
                  setInputs(initial.inputs);
                  setCopy(initial.copy);
                }}
              >
                Discard edits
              </Button>
            )}
          </div>
          {rendering && <p className="text-[11.5px] text-ink-muted">Rendering — actions are paused until it finishes.</p>}
        </section>
      )}

      {!readOnly && (
        <section className="space-y-1.5 border-t border-rule pt-4">
          <h3 className="text-[12.5px] font-semibold text-ink">Review</h3>
          <ReviewBar
            clientId={clientId}
            creativeId={creative.id}
            version={version}
            blockedReason={
              dirty
                ? "Save your edits first"
                : rendering
                  ? "Still rendering"
                  : stalled
                    ? "Previous run stalled — re-render before approving"
                    : null
            }
          />
        </section>
      )}
    </div>
  );
}
