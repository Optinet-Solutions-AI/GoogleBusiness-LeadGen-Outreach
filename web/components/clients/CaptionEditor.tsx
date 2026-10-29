"use client";

/**
 * CaptionEditor.tsx — one platform's caption textarea + hashtag chips with live counts against the platform limits.
 *
 * Inputs:  platform, value ({caption, hashtags}), disabled
 * Outputs: onChange(next value) — pure UI, no network
 * Used by: components/clients/CreativeView.tsx
 */

import { useState } from "react";
import { X } from "lucide-react";
import { PLATFORM_LIMITS } from "@/lib/creatives/limits";
import type { Platform, PlatformCopy } from "@/lib/creatives/types";

const FIELD = "w-full border border-rule rounded px-2 py-1.5 text-[12.5px] text-ink bg-surface outline-none focus:border-ink disabled:opacity-60";

export function CaptionEditor({
  platform,
  value,
  disabled,
  onChange,
}: {
  platform: Platform;
  value: PlatformCopy;
  disabled?: boolean;
  onChange: (next: PlatformCopy) => void;
}) {
  const [tag, setTag] = useState("");
  const lim = PLATFORM_LIMITS[platform];
  const charsOver = value.caption.length > lim.maxChars;
  const tagsOver = value.hashtags.length > lim.maxHashtags;

  function addTag() {
    const bare = tag.trim().replace(/^#/, "");
    setTag("");
    if (!bare) return;
    // match the stored style: keep a leading "#" unless existing tags are stored bare
    const hashed = value.hashtags.length === 0 || value.hashtags.some((h) => h.startsWith("#"));
    const next = hashed ? `#${bare}` : bare;
    if (!value.hashtags.includes(next)) onChange({ ...value, hashtags: [...value.hashtags, next] });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ink capitalize">{platform}</span>
        <span className="text-[11px] flex gap-3">
          <span className={charsOver ? "text-danger font-medium" : "text-ink-muted"}>
            {value.caption.length}/{lim.maxChars} chars
          </span>
          <span className={tagsOver ? "text-danger font-medium" : "text-ink-muted"}>
            {value.hashtags.length}/{lim.maxHashtags} hashtags
          </span>
        </span>
      </div>
      <textarea
        className={FIELD}
        rows={5}
        value={value.caption}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, caption: e.target.value })}
        aria-label={`${platform} caption`}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {value.hashtags.map((h) => (
          <span key={h} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-rule bg-surface-alt text-[11.5px] text-ink">
            {h.startsWith("#") ? h : `#${h}`}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${h}`}
                onClick={() => onChange({ ...value, hashtags: value.hashtags.filter((x) => x !== h) })}
                className="text-ink-muted hover:text-ink"
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            className="border border-rule rounded px-2 py-0.5 text-[11.5px] bg-surface text-ink outline-none focus:border-ink w-28"
            placeholder="Add hashtag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            aria-label={`${platform} add hashtag`}
          />
        )}
      </div>
    </div>
  );
}
