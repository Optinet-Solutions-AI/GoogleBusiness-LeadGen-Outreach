"use client";

/**
 * DraftReview.tsx — banner + side-by-side review of a pending AI draft (spec §4.5).
 *
 * Inputs:  clientId, current/draft { version, data }, diffPaths (changed paths, computed server-side)
 * Outputs: POST /api/clients/:id/brain/draft { action, paths? }, toast, router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Brain tab, above the editor)
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { getPath } from "@/lib/clients/profile-paths";
import type { BrandProfileData } from "@/lib/clients/types";

type Versioned = { version: number; data: BrandProfileData };

/** Readable text for whatever lives at a path (fact, fact list, audience/CTA facts, products). */
function readable(data: BrandProfileData | null, path: string): string {
  if (!data) return "(none)";
  if (path === "products") return data.products.length ? data.products.map((p) => p.name).join(", ") : "(none)";
  const v = getPath(data, path);
  const one = (f: unknown): string => {
    const val = (f as { value?: unknown } | null)?.value;
    if (val === null || val === undefined) return "";
    if (typeof val === "string") return val;
    const o = val as { name?: string; description?: string; text?: string; kind?: string };
    if (o.name !== undefined) return o.description ? `${o.name}: ${o.description}` : o.name;
    if (o.text !== undefined) return `${o.text} (${o.kind})`;
    return JSON.stringify(val);
  };
  const out = Array.isArray(v) ? v.map(one).filter(Boolean).join("; ") : one(v);
  return out || "(empty)";
}

export function DraftReview({
  clientId,
  current,
  draft,
  diffPaths,
}: {
  clientId: string;
  current: Versioned | null;
  draft: Versioned;
  diffPaths: string[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function act(action: "accept" | "discard" | "merge") {
    if (action === "discard" && !window.confirm("Discard this AI draft?")) return;
    setBusy(true);
    const res = await fetchJson(`/api/clients/${clientId}/brain/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "merge" ? { action, paths: [...picked] } : { action }),
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      router.refresh();
      return;
    }
    toast.success(action === "accept" ? "Draft accepted." : action === "merge" ? "Selected changes merged." : "Draft discarded.");
    router.refresh();
  }

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-4" data-testid="draft-review">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-[13px] font-medium text-ink">An AI draft (v{draft.version}) is waiting</p>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => act("accept")}>
            Accept all
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || picked.size === 0} onClick={() => act("merge")}>
            Merge selected
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => act("discard")}>
            Discard
          </Button>
        </div>
      </div>
      {diffPaths.length === 0 ? (
        <p className="text-[12px] text-ink-muted">The draft matches the current profile.</p>
      ) : (
        <div className="space-y-2">
          {diffPaths.map((p) => (
            <div key={p} className="border border-rule rounded p-3">
              <label className="flex items-center gap-2 mb-2 text-[12px] font-medium text-ink">
                <input type="checkbox" checked={picked.has(p)} onChange={() => toggle(p)} aria-label={`Take draft for ${p}`} />
                take draft · <code className="text-[11.5px] text-ink-muted">{p}</code>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12.5px]">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-subtle mb-0.5">Current{current ? ` v${current.version}` : ""}</div>
                  <div className="text-ink-muted whitespace-pre-wrap break-words">{readable(current?.data ?? null, p)}</div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-ink-subtle mb-0.5">Draft v{draft.version}</div>
                  <div className="text-ink whitespace-pre-wrap break-words">{readable(draft.data, p)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
