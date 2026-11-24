/**
 * WebsiteCheckButton.tsx — "Check website again": start an OpenAI website check and wait for it.
 *
 * Inputs:  leadId, pendingAt (a check already running), error (the last check failed), checked (a review exists)
 * Outputs: POST /api/leads/:id/website-review, then polls GET every 5 s until the check is done → router.refresh()
 * Used by: app/(dashboard)/leads/[id]/page.tsx (WebsiteVerdictCard)
 *
 * Dumb: shows state and fires the action. The check runs on Cloud Run (about a minute, about 1 cent).
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

const POLL_MS = 5_000;
const GIVE_UP_MS = 3 * 60_000;

export function WebsiteCheckButton({
  leadId,
  pendingAt,
  error,
  checked,
}: {
  leadId: string;
  pendingAt: string | null;
  error: string | null;
  checked: boolean;
}) {
  const router = useRouter();
  const recent = pendingAt ? Date.now() - Date.parse(pendingAt) < GIVE_UP_MS : false;
  const [checking, setChecking] = useState(recent);
  const [message, setMessage] = useState<string | null>(error);
  const startedAt = useRef<number>(pendingAt ? Date.parse(pendingAt) : Date.now());

  useEffect(() => {
    if (!checking) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setChecking(false);
        setMessage("The check is taking longer than usual. Refresh the page in a minute, or try again.");
        return;
      }
      try {
        const res = await fetch(`/api/leads/${leadId}/website-review`, { cache: "no-store" });
        const json = await res.json();
        const review = json?.data?.review as { pending_at?: string | null; error?: string | null } | null;
        if (json.success && review && !review.pending_at) {
          setChecking(false);
          setMessage(review.error ?? null);
          router.refresh();
          return;
        }
      } catch {
        /* keep polling */
      }
      setTimeout(tick, POLL_MS);
    };
    const t = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [checking, leadId, router]);

  async function start() {
    setMessage(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/website-review`, { method: "POST" });
      const json = await res.json();
      if (!json.success) {
        setMessage(json.error ?? "Couldn't start the check.");
        return;
      }
      startedAt.current = Date.now();
      setChecking(true);
    } catch {
      setMessage("Couldn't start the check. Try again.");
    }
  }

  return (
    <div className="space-y-1.5 pt-1">
      <button type="button" className="btn w-full" onClick={start} disabled={checking}>
        <RefreshCw className={checking ? "animate-spin" : ""} strokeWidth={1.75} />
        {checking ? "Checking their website…" : checked ? "Check website again" : "Check website with AI"}
      </button>
      <p className="text-[11px] text-ink-subtle">
        {checking
          ? "AI is opening their homepage and looking at it. Takes about a minute."
          : "AI opens their homepage, looks at it and decides what to pitch. About 1 cent."}
      </p>
      {message && <p className="text-[12px] text-urgent">{message}</p>}
    </div>
  );
}
