/**
 * (public)/test-form/page.tsx — the RateUp test contact page: a plain "Contact us" form with no CAPTCHA.
 *
 * Inputs:  none
 * Outputs: renders <TestForm>, which posts to /api/test-form
 * Used by: QA and the AI contact-form sender (point a test lead's website + contact page here, 25 Nov 2026)
 *
 * Messages land on /test-form-received in the dashboard; nothing is emailed or sent anywhere.
 */
import { TestForm } from "./TestForm";

export const metadata = { title: "Contact us · RateUp test form" };

export default function TestFormPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-semibold text-ink">Contact us</h1>
        <p className="text-[13px] text-ink-muted">RateUp test form. Send us a message and we&rsquo;ll get back to you.</p>
      </div>
      <TestForm />
    </div>
  );
}
