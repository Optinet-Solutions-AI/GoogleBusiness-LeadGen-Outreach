"use client";

/**
 * IntakeForm.tsx — the short, customer-facing intake form behind a one-time link.
 *
 * Inputs:  token (one-time), business (for a personalized heading)
 * Outputs: POST /api/form/[token] with the answers; shows a thank-you on success
 * Used by: app/(public)/form/[token]/page.tsx
 *
 * Client component (form state). Chrome-free — no dashboard nav around it.
 */

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type State = "idle" | "submitting" | "done" | "error";

export function IntakeForm({ token, business }: { token: string; business: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [bestTime, setBestTime] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("submitting");
    setError(null);
    try {
      const res = await fetch(`/api/form/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, bestTime, details }),
      });
      const json = await res.json();
      if (json.success) {
        setState("done");
      } else {
        setState("error");
        setError(json.error ?? "Something went wrong.");
      }
    } catch {
      setState("error");
      setError("Couldn't submit — please try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="text-center">
        <div className="text-[40px] mb-3">✓</div>
        <h1 className="text-[22px] font-semibold text-ink mb-2">Thank you!</h1>
        <p className="text-[14px] text-ink-muted">
          Got it — Sam will put your free website sample together and be in touch shortly. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold text-ink leading-snug">
          A free website sample for {business}
        </h1>
        <p className="text-[14px] text-ink-muted mt-1.5">
          Drop a few details and I&apos;ll build a sample you can look at — no cost, no commitment.
        </p>
      </div>

      <Field label="Your name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-rule bg-canvas text-ink text-[14px] px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-action"
          placeholder="Jane Smith"
        />
      </Field>

      <Field label="Best email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-rule bg-canvas text-ink text-[14px] px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-action"
          placeholder="you@business.com"
        />
      </Field>

      <Field label="Best time to reach you">
        <input
          type="text"
          value={bestTime}
          onChange={(e) => setBestTime(e.target.value)}
          className="w-full rounded border border-rule bg-canvas text-ink text-[14px] px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-action"
          placeholder="Weekday mornings"
        />
      </Field>

      <Field label="What should the website do for you? (optional)">
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          className="w-full rounded border border-rule bg-canvas text-ink text-[14px] px-3 py-2.5 resize-y focus:outline-none focus:ring-1 focus:ring-action"
          placeholder="Get more calls, show my services, take bookings…"
        />
      </Field>

      {error && <p className="text-[13px] text-urgent">{error}</p>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        loading={state === "submitting"}
      >
        {state === "submitting" ? "Sending…" : "Send my details"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-ink mb-1.5">{label}</span>
      {children}
    </label>
  );
}
