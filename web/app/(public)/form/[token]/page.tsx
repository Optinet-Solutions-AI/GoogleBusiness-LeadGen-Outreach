/**
 * (public)/form/[token]/page.tsx — the one-time intake form behind an SMS link.
 *
 * Server component: hashes + validates the token, flips the link to 'opened', personalizes with the
 * business name, then renders the client <IntakeForm>. Invalid / expired / used / unknown tokens all
 * show the SAME generic message (no enumeration). Chrome-free via the (public) layout.
 */
import { getLinkByToken, markOpened } from "@/lib/form-links";
import { getDb } from "@/lib/db";
import { IntakeForm } from "@/components/IntakeForm";

export const dynamic = "force-dynamic";

export default async function FormPage({ params }: { params: { token: string } }) {
  const link = await getLinkByToken(params.token);
  const valid =
    !!link &&
    (link.status === "issued" || link.status === "opened") &&
    new Date(link.expires_at).getTime() > Date.now();

  if (!valid) {
    return (
      <div className="text-center">
        <h1 className="text-[20px] font-semibold text-ink mb-2">This link isn&apos;t available</h1>
        <p className="text-[14px] text-ink-muted">
          It may have expired or already been used. If you still want your free sample, just reply to
          Sam&apos;s text or give him a call back.
        </p>
      </div>
    );
  }

  await markOpened(link!.id);

  const { data: lead } = await getDb()
    .from("leads")
    .select("business_name")
    .eq("id", link!.lead_id)
    .maybeSingle();
  const business = (lead?.business_name as string) || "your business";

  return <IntakeForm token={params.token} business={business} />;
}
