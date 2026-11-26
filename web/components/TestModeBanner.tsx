/**
 * TestModeBanner.tsx — the blue strip on every dashboard page while Test mode is on (26 Nov 2026).
 *
 * Inputs:  the setting (lib/test-mode.ts getTestMode, read on the server: fail-closed = on)
 * Outputs: "Test mode: nothing reaches a real business…" with how many test contacts are on the list and a link to the
 *          Test list page; nothing when off
 * Used by: app/(dashboard)/layout.tsx
 *
 * Shown so QA always knows sends only reach the test list. No switch here: the operator turns it off by asking.
 */
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { getTestMode } from "@/lib/test-mode";

export async function TestModeBanner() {
  // Read on every request: a page built ahead of time must never freeze the banner (on or off).
  noStore();
  const m = await getTestMode().catch(() => null);
  if (m && !m.on) return null;
  const n = m ? m.emails.length + m.phones.length + m.hosts.length : 0;
  return (
    <div className="border-b border-action/30 bg-action/10 px-4 py-2 text-[13px] text-ink" role="status">
      <div className="mx-auto flex max-w-6xl items-start gap-2">
        <FlaskConical className="mt-0.5 h-4 w-4 flex-none text-action" strokeWidth={2} aria-hidden />
        <p>
          <span className="font-semibold">Test mode:</span> nothing is sent to a real business. Emails, contact forms and AI calls only reach the
          test list ({n} test contact{n === 1 ? "" : "s"}): anything else is refused with a message, or waits until the app goes live.{" "}
          <Link href="/test-list" className="font-semibold text-action hover:underline">
            Add your email and phone to the test list
          </Link>{" "}
          before testing. Only Chris can switch to live.
        </p>
      </div>
    </div>
  );
}
