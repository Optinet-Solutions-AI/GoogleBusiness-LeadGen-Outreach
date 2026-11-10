/**
 * OpenAiBanner.tsx — amber strip under the top bar when AI research (OpenAI) is unavailable.
 *
 * Inputs:  GET /api/health/openai
 * Outputs: a banner that lowers expectations (crawl-only lead research, no conference discovery, no assistant)
 * Used by: app/(dashboard)/layout.tsx
 *
 * Client-side so a slow OpenAI check never delays a page. "Hide" lasts for this browser tab only.
 */
"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

const HIDE_KEY = "rateup.openaiBanner.hidden";

export function OpenAiBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let hidden = false;
    try {
      hidden = window.sessionStorage.getItem(HIDE_KEY) === "1";
    } catch {
      /* storage blocked: always show */
    }
    if (hidden) return;
    fetch("/api/health/openai")
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && j.data?.state && j.data.state !== "ok") setMessage(String(j.data.message));
      })
      .catch(() => {});
  }, []);

  if (!message) return null;
  return (
    <div className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-[13px] text-warning" role="status">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          <span>{message}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            try {
              window.sessionStorage.setItem(HIDE_KEY, "1");
            } catch {
              /* fine */
            }
          }}
          className="flex flex-none items-center gap-1 font-semibold hover:underline"
          aria-label="Hide this warning"
        >
          Hide <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
