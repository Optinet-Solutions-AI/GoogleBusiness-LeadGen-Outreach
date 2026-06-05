"use client";

/**
 * ConnectSocialButton.tsx — add the dedicated social handle the team DMs from.
 *
 * Inputs:  none
 * Outputs: POST /api/social-accounts → toast + refresh
 * Used by: the Social worklist page header.
 *
 * Reference/config only — Meta blocks automated cold DMs, so this just records
 * which shared account everyone sends from (shown on each lead's DM action).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/toast-store";
import { fetchJson } from "@/lib/fetch-json";

const PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin", "twitter", "other"] as const;
const INPUT =
  "w-full h-9 px-3 text-[13px] text-ink border border-rule-strong rounded-lg focus:ring-2 focus:ring-action/20 focus:border-action outline-none";

export function ConnectSocialButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("instagram");
  const [handle, setHandle] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!handle.trim()) {
      toast.warning("Enter the account handle (e.g. @youragency).");
      return;
    }
    setSaving(true);
    const res = await fetchJson<{ id: string }>("/api/social-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        handle: handle.trim(),
        profile_url: profileUrl.trim() || undefined,
        label: label.trim() || undefined,
      }),
    });
    setSaving(false);
    if (!res.success) {
      toast.error(res.error, { title: "Couldn't add account" });
      return;
    }
    toast.success(`Added ${handle.trim()}.`);
    setOpen(false);
    setHandle("");
    setProfileUrl("");
    setLabel("");
    router.refresh();
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Plus strokeWidth={2.5} /> Add account
      </Button>

      {open && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <section
            className="bg-white w-full max-w-[440px] rounded-xl border border-rule shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h2 className="text-[15px] font-semibold text-ink">Dedicated DM account</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-ink-subtle hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-[12px] text-ink-muted leading-relaxed">
              The shared account your team DMs leads from. We don&apos;t auto-send (Meta blocks cold
              DMs) — this just keeps everyone sending from the same handle.
            </p>

            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Platform</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} className={INPUT}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p} className="capitalize">{p}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Handle</span>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@youragency" className={INPUT} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Profile URL (optional)</span>
              <input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://instagram.com/youragency" className={INPUT} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">Label (optional)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main brand account" className={INPUT} />
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={save} loading={saving}>Save</Button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
