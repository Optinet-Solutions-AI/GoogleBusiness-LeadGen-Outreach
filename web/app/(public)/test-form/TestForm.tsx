/**
 * (public)/test-form/TestForm.tsx — the test contact form's fields and Send button.
 *
 * Inputs:  what the visitor (or the AI sender) types
 * Outputs: POST /api/test-form; a plain "Thank you" message when it was saved
 * Used by: app/(public)/test-form/page.tsx
 *
 * Dumb: a standard <form> with labelled fields, like a small business's contact page.
 */
"use client";

import { useState } from "react";

const INPUT = "w-full h-10 px-3 text-[14px] border border-rule-strong rounded-md bg-white outline-none focus:ring-2 focus:ring-action/20 focus:border-action";

export function TestForm() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending");
    setError(null);
    const res = await fetch("/api/test-form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(f.entries())),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    if (json?.success) return setState("sent");
    setState("idle");
    setError(json?.error ?? "Your message couldn't be sent. Please try again.");
  }

  if (state === "sent") {
    return (
      <div role="status" className="rounded-lg border border-rule bg-surface-alt p-4 text-[14px] text-ink">
        <p className="font-semibold">Thank you! Your message has been sent.</p>
        <p className="text-ink-muted">We&rsquo;ll get back to you soon.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-label="Contact form">
      <label className="block text-[13px] text-ink">
        Name *
        <input name="name" required autoComplete="name" className={INPUT} />
      </label>
      <label className="block text-[13px] text-ink">
        Email *
        <input name="email" type="email" required autoComplete="email" className={INPUT} />
      </label>
      <label className="block text-[13px] text-ink">
        Phone
        <input name="phone" type="tel" autoComplete="tel" className={INPUT} />
      </label>
      <label className="block text-[13px] text-ink">
        Subject
        <input name="subject" className={INPUT} />
      </label>
      <label className="block text-[13px] text-ink">
        Message *
        <textarea name="message" required rows={6} className={`${INPUT} h-auto py-2`} />
      </label>
      {error && <p className="text-[13px] text-urgent">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="btn btn-primary w-full">
        {state === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
