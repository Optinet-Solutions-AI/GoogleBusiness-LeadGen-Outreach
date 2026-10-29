"use client";

/**
 * CreativeCard.tsx — one post tile: 1:1 thumbnail (or template placeholder), date, platforms, state, grounding badge.
 *
 * Inputs:  creative (CreativeListRow incl. latest version summary)
 * Outputs: a link to ?tab=posts&creative=<id> (no actions)
 * Used by: PostsTab
 */

import Link from "next/link";
import { AlertTriangle, ImageOff } from "lucide-react";
import { TEMPLATES } from "@/lib/creatives/templates/registry";
import type { CreativeListRow } from "@/lib/creatives/creatives";

const STATE_TONE: Record<string, string> = {
  approved: "text-positive",
  draft: "text-ink-muted",
  changes_requested: "text-warning",
  rejected: "text-danger",
};

function thumbUrl(c: CreativeListRow): string | null {
  const r = c.latest?.renders?.find((x) => x.aspect === "1:1" && (x.slide === null || x.slide === 1));
  return r?.public_url ?? null;
}

function groundingTone(c: CreativeListRow): "blocker" | "warning" | null {
  const g = c.latest?.grounding;
  if (!g) return null;
  if (g.ok === false) return "blocker";
  return g.issues?.some((i) => i.warning) ? "warning" : null;
}

export function CreativeCard({ creative: c }: { creative: CreativeListRow }) {
  const thumb = thumbUrl(c);
  const gTone = groundingTone(c);
  const state = c.latest?.state ?? (c.status === "failed" ? "failed" : c.status === "rendering" ? "rendering" : "no render");
  return (
    <Link
      href={`?tab=posts&creative=${c.id}`}
      className="block bg-surface border border-rule rounded-lg overflow-hidden hover:border-ink"
    >
      <div className="aspect-square bg-surface-alt flex items-center justify-center text-ink-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={c.title ?? "Post"} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-[11.5px]">
            <ImageOff size={20} aria-hidden />
            {TEMPLATES[c.template_key].label}
          </div>
        )}
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-[12.5px] font-medium text-ink truncate">{c.title ?? "Untitled post"}</p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
          <span className="whitespace-nowrap shrink-0">{c.slot_date ?? "Unscheduled"}</span>
          <span className="capitalize">{c.platforms.join(" · ")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex px-2 py-0.5 rounded text-[10.5px] font-medium border border-rule bg-surface-alt capitalize ${STATE_TONE[state] ?? "text-ink-muted"}`}
          >
            {state.replace("_", " ")}
          </span>
          {gTone && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium border bg-surface-alt ${
                gTone === "blocker" ? "border-danger text-danger" : "border-rule text-warning"
              }`}
              title={
                gTone === "blocker"
                  ? "Copy has a claim that blocks approval"
                  : "Copy has claims that could not be matched to the Brand Brain"
              }
            >
              <AlertTriangle size={11} aria-hidden /> {gTone === "blocker" ? "Blocked" : "Grounding"}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
