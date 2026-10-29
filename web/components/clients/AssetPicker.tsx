"use client";

/**
 * AssetPicker.tsx — small popover grid of image thumbnails with multi-select.
 *
 * Inputs:  assets (ready images only are shown), selected asset ids
 * Outputs: onChange(next ids) — pure UI, no network
 * Used by: components/clients/ProductsPanel.tsx
 */

import { useState } from "react";
import { Check, ImagePlus } from "lucide-react";
import type { AssetRow } from "@/lib/clients/assets";

type PickerAsset = Pick<AssetRow, "id" | "kind" | "status" | "public_url" | "alt">;

export function AssetPicker({
  assets,
  selected,
  onChange,
}: {
  assets: PickerAsset[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const images = assets.filter((a) => a.status === "ready" && a.public_url && (a.kind === "logo" || a.kind === "photo"));
  const chosen = images.filter((a) => selected.includes(a.id));

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 flex-wrap">
        {chosen.map((a) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={a.id} src={a.public_url!} alt={a.alt ?? "product image"} className="h-8 w-8 object-cover rounded border border-rule" />
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 h-8 px-2 rounded border border-rule text-[11.5px] text-ink-muted hover:text-ink"
          aria-expanded={open}
        >
          <ImagePlus size={13} /> {chosen.length ? "Edit" : "Images"}
        </button>
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-64 max-h-60 overflow-auto bg-surface border border-rule rounded-lg shadow-lg p-2">
          {images.length === 0 ? (
            <p className="text-[12px] text-ink-subtle p-2">No images yet — upload some in the Assets tab.</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {images.map((a) => {
                const on = selected.includes(a.id);
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => toggle(a.id)}
                    className={`relative h-14 w-full rounded overflow-hidden border ${on ? "border-ink" : "border-rule"}`}
                    aria-pressed={on}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.public_url!} alt={a.alt ?? "asset"} className="h-full w-full object-cover" />
                    {on && (
                      <span className="absolute top-0.5 right-0.5 bg-ink text-surface rounded-full p-0.5">
                        <Check size={10} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex justify-end mt-2">
            <button type="button" className="text-[11.5px] text-ink-muted hover:text-ink underline" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
