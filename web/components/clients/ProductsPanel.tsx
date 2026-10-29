"use client";

/**
 * ProductsPanel.tsx — product list for a client: add, inline edit, feature, reorder, images, delete.
 *
 * Inputs:  clientId, products (ProductSnapshot[]), assets (for the image picker)
 * Outputs: POST/PATCH/DELETE /api/clients/:id/products[/:pid] (each returns the new list), toasts, router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Products tab)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import { AssetPicker } from "@/components/clients/AssetPicker";
import type { ProductSnapshot } from "@/lib/clients/types";
import type { AssetRow } from "@/lib/clients/assets";

const MAX_FEATURED = 10;
const FIELD =
  "w-full bg-transparent border border-transparent hover:border-rule focus:border-ink rounded px-1.5 py-1 text-[12.5px] text-ink outline-none";

type Asset = Pick<AssetRow, "id" | "kind" | "status" | "public_url" | "alt">;
type TextKey = "name" | "description" | "price" | "category";
const TEXT_KEYS: TextKey[] = ["name", "description", "price", "category"];

export function ProductsPanel({
  clientId,
  products: initial,
  assets,
}: {
  clientId: string;
  products: ProductSnapshot[];
  assets: Asset[];
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", price: "", category: "" });
  const [newImages, setNewImages] = useState<string[]>([]);
  useEffect(() => setProducts(initial), [initial]);

  const featuredCount = products.filter((p) => p.featured).length;
  const base = `/api/clients/${clientId}/products`;

  async function call(url: string, method: string, body: unknown, okMsg: string): Promise<boolean> {
    setBusy(true);
    const res = await fetchJson<ProductSnapshot[]>(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      router.refresh();
      return false;
    }
    setProducts(res.data);
    toast.success(okMsg);
    router.refresh();
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const ok = await call(
      base,
      "POST",
      {
        name: draft.name.trim(),
        description: draft.description || null,
        price: draft.price || null,
        category: draft.category || null,
        image_asset_ids: newImages,
      },
      "Product added.",
    );
    if (ok) {
      setDraft({ name: "", description: "", price: "", category: "" });
      setNewImages([]);
    }
  }

  function saveText(p: ProductSnapshot, key: TextKey, value: string) {
    if (value === (p[key] ?? "")) return;
    if (key === "name" && !value.trim()) {
      toast.error("Name cannot be empty.");
      router.refresh();
      return;
    }
    void call(`${base}/${p.id}`, "PATCH", { [key]: key === "name" ? value.trim() : value || null }, "Product saved.");
  }

  function move(i: number, dir: -1 | 1) {
    const order = products.map((p) => p.id as string);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void call(base, "PATCH", { order }, "Order saved.");
  }

  function remove(p: ProductSnapshot) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    void call(`${base}/${p.id}`, "DELETE", undefined, "Product deleted.");
  }

  const commit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-rule rounded-lg">
        <div className="flex items-center justify-between px-5 py-3 border-b border-rule">
          <h3 className="text-[13px] font-semibold text-ink">Products</h3>
          <span className="text-[11.5px] text-ink-muted">
            {products.length} total · {featuredCount}/{MAX_FEATURED} featured
          </span>
        </div>
        {products.length === 0 && <p className="p-8 text-center text-[13px] text-ink-muted">No products yet — add one below.</p>}
        <ul className="divide-y divide-rule">
          {products.map((p, i) => {
            const blocked = !p.featured && featuredCount >= MAX_FEATURED;
            return (
              <li key={p.id ?? i} className="px-4 py-3 grid gap-2 md:grid-cols-[1.4fr_2fr_0.7fr_1fr_auto] items-start">
                {TEXT_KEYS.map((k) => (
                  <input
                    key={`${k}-${p[k] ?? ""}`}
                    className={`${FIELD} ${k === "name" ? "font-medium" : ""}`}
                    defaultValue={p[k] ?? ""}
                    placeholder={k[0].toUpperCase() + k.slice(1)}
                    aria-label={k[0].toUpperCase() + k.slice(1)}
                    disabled={busy}
                    onBlur={(e) => saveText(p, k, e.target.value)}
                    onKeyDown={commit}
                  />
                ))}
                <div className="flex items-center gap-1 justify-end">
                  <button
                    type="button"
                    disabled={blocked || busy}
                    aria-pressed={p.featured}
                    title={blocked ? `Already ${MAX_FEATURED} featured — unfeature one first` : p.featured ? "Featured" : "Mark as featured"}
                    className={`p-1.5 rounded ${p.featured ? "text-warning" : "text-ink-subtle hover:text-ink"} disabled:opacity-40 disabled:cursor-not-allowed`}
                    onClick={() => void call(`${base}/${p.id}`, "PATCH", { featured: !p.featured }, p.featured ? "Unfeatured." : "Featured.")}
                  >
                    <Star size={15} fill={p.featured ? "currentColor" : "none"} />
                  </button>
                  <button type="button" aria-label="Move up" disabled={i === 0 || busy} className="p-1.5 text-ink-muted hover:text-ink disabled:opacity-30" onClick={() => move(i, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" aria-label="Move down" disabled={i === products.length - 1 || busy} className="p-1.5 text-ink-muted hover:text-ink disabled:opacity-30" onClick={() => move(i, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" aria-label="Delete product" disabled={busy} className="p-1.5 text-ink-muted hover:text-negative" onClick={() => remove(p)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="md:col-span-5 pl-1.5">
                  <AssetPicker
                    assets={assets}
                    selected={p.image_asset_ids}
                    onChange={(ids) => void call(`${base}/${p.id}`, "PATCH", { image_asset_ids: ids }, "Images saved.")}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <form onSubmit={add} className="bg-surface border border-rule rounded-lg p-5 space-y-3">
        <h3 className="text-[13px] font-semibold text-ink">Add product</h3>
        <div className="grid gap-2 md:grid-cols-4">
          {TEXT_KEYS.map((k) => (
            <input
              key={k}
              aria-label={`New product ${k}`}
              placeholder={k[0].toUpperCase() + k.slice(1)}
              value={draft[k]}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              className="border border-rule rounded px-2 py-1.5 text-[12.5px] bg-surface text-ink outline-none focus:border-ink"
            />
          ))}
        </div>
        <AssetPicker assets={assets} selected={newImages} onChange={setNewImages} />
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy || !draft.name.trim()}>
          Add product
        </Button>
      </form>
    </div>
  );
}
