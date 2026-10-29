"use client";

/**
 * PostsTab.tsx — Posts tab: month header, state/platform filters, creative grid, "Make a post" modal.
 *
 * Inputs:  clientId, month, plan, creatives (server-loaded for the month), imageUsd
 * Outputs: POST /api/clients/:id/creatives (free DB insert), then navigates to ?tab=posts&creative=<id>
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Posts tab)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { MonthHeader } from "@/components/clients/MonthHeader";
import { CreativeCard } from "@/components/clients/CreativeCard";
import { TEMPLATES } from "@/lib/creatives/templates/registry";
import {
  PLATFORMS,
  TEMPLATE_KEYS,
  VERSION_STATES,
  type CreativeKind,
  type Platform,
  type TemplateKey,
} from "@/lib/creatives/types";
import type { CreativeListRow } from "@/lib/creatives/creatives";
import type { PlanRow } from "@/lib/creatives/plans";

const FIELD = "w-full border border-rule rounded px-2 py-1.5 text-[12.5px] text-ink bg-surface outline-none focus:border-ink";
const SELECT = "border border-rule rounded px-2 py-1 text-[12.5px] bg-surface text-ink";

function MakePostModal({ clientId, month, onClose }: { clientId: string; month: string; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [templateKey, setTemplateKey] = useState<TemplateKey>("offer");
  const [kind, setKind] = useState<CreativeKind>("image");
  const [platforms, setPlatforms] = useState<Platform[]>(["instagram"]);
  const [busy, setBusy] = useState(false);
  const canCarousel = TEMPLATES[templateKey].supportsCarousel;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !brief.trim() || !platforms.length) return;
    setBusy(true);
    try {
      const res = await fetchJson<{ creative: { id: string } }>(`/api/clients/${clientId}/creatives`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          brief: brief.trim(),
          template_key: templateKey,
          kind: canCarousel ? kind : "image",
          platforms,
          slot_date: `${month}-01`,
        }),
      });
      if (!res.success) return toast.error(res.error);
      router.push(`?tab=posts&month=${month}&creative=${res.data.creative.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Make a post"
    >
      <form onSubmit={submit} className="bg-surface border border-rule rounded-lg w-full max-w-md p-5 space-y-3">
        <h3 className="text-[13px] font-semibold text-ink">Make a post</h3>
        <input className={FIELD} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <textarea
          className={FIELD}
          rows={3}
          placeholder="Brief: what should this post say?"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          aria-label="Brief"
        />
        <div className="grid grid-cols-2 gap-2">
          <select className={FIELD} value={templateKey} onChange={(e) => setTemplateKey(e.target.value as TemplateKey)} aria-label="Template">
            {TEMPLATE_KEYS.map((k) => (
              <option key={k} value={k}>
                {TEMPLATES[k].label}
              </option>
            ))}
          </select>
          <select
            className={FIELD}
            value={canCarousel ? kind : "image"}
            disabled={!canCarousel}
            onChange={(e) => setKind(e.target.value as CreativeKind)}
            aria-label="Kind"
          >
            <option value="image">Single image</option>
            <option value="carousel">Carousel</option>
          </select>
        </div>
        <fieldset className="flex gap-4 text-[12.5px] text-ink">
          {PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 capitalize">
              <input
                type="checkbox"
                checked={platforms.includes(p)}
                onChange={(e) => setPlatforms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))}
              />
              {p}
            </label>
          ))}
        </fieldset>
        <p className="text-[11.5px] text-ink-muted">Creating a post is free. Nothing is generated until you choose to.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy} disabled={!title.trim() || !brief.trim() || !platforms.length}>
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}

export function PostsTab({
  clientId,
  month,
  plan,
  creatives,
  imageUsd,
}: {
  clientId: string;
  month: string;
  plan: PlanRow | null;
  creatives: CreativeListRow[];
  imageUsd: number;
}) {
  const [stateFilter, setStateFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [modal, setModal] = useState(false);

  const shown = creatives.filter(
    (c) =>
      (!stateFilter || c.latest?.state === stateFilter) &&
      (!platformFilter || c.platforms.includes(platformFilter as Platform)),
  );

  return (
    <div className="space-y-4">
      <MonthHeader
        clientId={clientId}
        month={month}
        plan={plan}
        creatives={creatives}
        imageUsd={imageUsd}
        onMakePost={() => setModal(true)}
      />
      <div className="flex gap-2">
        <select className={SELECT} value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} aria-label="Filter by state">
          <option value="">All states</option>
          {VERSION_STATES.filter((s) => s !== "superseded").map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select className={SELECT} value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} aria-label="Filter by platform">
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="bg-surface border border-rule rounded-lg p-12 text-center text-[13px] text-ink-muted">
          {creatives.length === 0 ? "No posts for this month yet. Make a post to get started." : "No posts match these filters."}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {shown.map((c) => (
            <CreativeCard key={c.id} creative={c} />
          ))}
        </div>
      )}
      {modal && <MakePostModal clientId={clientId} month={month} onClose={() => setModal(false)} />}
    </div>
  );
}
