"use client";

/**
 * AssetsPanel.tsx — brand asset grid + drag/drop upload (signed-URL, three-step) + set-logo/delete.
 *
 * Inputs:  clientId, assets (AssetRow[]), logoAssetId (current profile logo or null)
 * Outputs: POST /assets -> PUT signed_url -> POST /assets/:aid/complete; PATCH set_logo; DELETE; toasts, router.refresh()
 * Used by: app/(dashboard)/clients/[id]/page.tsx (Assets tab)
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Film, Trash2, UploadCloud } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { toast } from "@/components/ui/toast-store";
import type { AssetRow } from "@/lib/clients/assets";

type Progress = { name: string; state: "uploading" | "done" | "failed" };

function imageDims(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function AssetsPanel({
  clientId,
  assets,
  logoAssetId,
}: {
  clientId: string;
  assets: AssetRow[];
  logoAssetId: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Record<number, Progress>>({});
  const [dragOver, setDragOver] = useState(false);
  const base = `/api/clients/${clientId}/assets`;

  function mark(i: number, p: Progress) {
    setProgress((s) => ({ ...s, [i]: p }));
  }

  async function uploadOne(file: File, i: number): Promise<void> {
    mark(i, { name: file.name, state: "uploading" });
    const start = await fetchJson<{ asset_id: string; signed_url: string }>(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, content_type: file.type, bytes: file.size }),
    });
    if (!start.success) {
      toast.error(`${file.name}: ${start.error}`);
      return mark(i, { name: file.name, state: "failed" });
    }
    try {
      const put = await fetch(start.data.signed_url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      if (!put.ok) throw new Error(`storage upload failed (${put.status})`);
    } catch (e) {
      toast.error(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      return mark(i, { name: file.name, state: "failed" });
    }
    const dims = file.type.startsWith("image/") ? await imageDims(file) : null;
    const done = await fetchJson(`${base}/${start.data.asset_id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dims ?? {}),
    });
    if (!done.success) {
      toast.error(`${file.name}: ${done.error}`);
      return mark(i, { name: file.name, state: "failed" });
    }
    mark(i, { name: file.name, state: "done" });
    toast.success(`${file.name} uploaded.`);
    router.refresh();
  }

  async function uploadAll(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setProgress({});
    await Promise.all(list.map((f, i) => uploadOne(f, i)));
  }

  async function setLogo(a: AssetRow) {
    const res = await fetchJson(`${base}/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ set_logo: true }),
    });
    if (!res.success) return void toast.error(res.error);
    toast.success("Logo updated.");
    router.refresh();
  }

  async function remove(a: AssetRow) {
    if (!confirm("Delete this asset?")) return;
    const res = await fetchJson(`${base}/${a.id}`, { method: "DELETE" });
    if (!res.success) return void toast.error(res.error);
    toast.success("Asset deleted.");
    router.refresh();
  }

  const entries = Object.entries(progress);
  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void uploadAll(e.dataTransfer.files);
        }}
        className={`bg-surface border border-dashed rounded-lg p-6 text-center ${dragOver ? "border-ink bg-surface-alt" : "border-rule"}`}
      >
        <UploadCloud size={22} className="mx-auto text-ink-muted" />
        <p className="text-[13px] text-ink mt-2">
          Drop files here or{" "}
          <button type="button" className="underline" onClick={() => inputRef.current?.click()}>
            browse
          </button>
        </p>
        <p className="text-[11.5px] text-ink-subtle mt-1">Images jpg/png/webp up to 15 MB, video mp4/mov up to 100 MB, PDF up to 20 MB.</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Upload files"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,application/pdf"
          onChange={(e) => {
            void uploadAll(e.target.files ?? []);
            e.target.value = "";
          }}
        />
        {entries.length > 0 && (
          <ul className="mt-3 space-y-1 text-[12px] text-ink-muted">
            {entries.map(([k, p]) => (
              <li key={k}>
                {p.name} — {p.state === "uploading" ? "uploading…" : p.state === "done" ? "done" : "failed"}
              </li>
            ))}
          </ul>
        )}
      </div>

      {assets.length === 0 ? (
        <div className="bg-surface border border-rule rounded-lg p-10 text-center">
          <p className="text-[13px] text-ink-muted">No assets yet.</p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
          {assets.map((a) => {
            const isImage = (a.kind === "logo" || a.kind === "photo") && !!a.public_url;
            const isLogo = a.id === logoAssetId;
            return (
              <div key={a.id} className="bg-surface border border-rule rounded-lg overflow-hidden flex flex-col" data-asset={a.id}>
                <div className="relative h-32 bg-surface-alt flex items-center justify-center">
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.public_url!} alt={a.alt ?? "asset"} className="h-full w-full object-cover" />
                  ) : a.kind === "video" ? (
                    <Film size={28} className="text-ink-subtle" />
                  ) : (
                    <FileText size={28} className="text-ink-subtle" />
                  )}
                  {isLogo && (
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-ink text-surface text-[10.5px] font-medium">Logo</span>
                  )}
                  {a.status === "pending" && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-surface border border-rule text-[10.5px] text-warning">pending</span>
                  )}
                </div>
                <div className="p-2.5 text-[11.5px] text-ink-muted space-y-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded border border-rule bg-surface-alt text-[10.5px]">{a.origin}</span>
                    <span className="capitalize">{a.kind}</span>
                  </div>
                  {a.width && a.height && (
                    <div>
                      {a.width} × {a.height}
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    {isImage && !isLogo && a.status === "ready" ? (
                      <button type="button" className="underline hover:text-ink" onClick={() => void setLogo(a)}>
                        Set as logo
                      </button>
                    ) : (
                      <span />
                    )}
                    <button type="button" aria-label="Delete asset" className="p-1 hover:text-negative" onClick={() => void remove(a)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
