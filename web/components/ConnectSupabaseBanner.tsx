/**
 * ConnectSupabaseBanner.tsx — yellow header banner shown in the dashboard
 * when Supabase isn't fully wired up. Three states:
 *
 *   1. unconfigured  → env vars missing, point to Vercel env settings
 *   2. no_schema     → env vars set but tables don't exist; show schema-apply path
 *   3. error         → other DB error (connection / RLS / etc.)
 *
 * Renders nothing when health = 'ok'.
 */

import { AlertTriangle, ExternalLink, Database } from "lucide-react";
import { getDbHealth, supabaseSqlEditorUrl } from "@/lib/safe-db";

const VERCEL_ENV_URL =
  "https://vercel.com/optinet-solutions-ais-andbox/google-business-lead-gen-outreach/settings/environment-variables";
const SCHEMA_GH_URL =
  "https://github.com/Optinet-Solutions-AI/GoogleBusiness-LeadGen-Outreach/blob/main/db/schema.sql";

export async function ConnectSupabaseBanner() {
  const health = await getDbHealth();
  if (health === "ok") return null;

  if (health === "unconfigured") {
    return (
      <Banner tone="amber" icon={<AlertTriangle className="h-4 w-4" />} action={{ href: VERCEL_ENV_URL, label: "Open env vars" }}>
        <span className="font-semibold">Supabase not configured.</span>{" "}
        Set <code className="font-mono text-[12px] bg-amber-100 px-1.5 py-0.5 rounded">SUPABASE_URL</code> +{" "}
        <code className="font-mono text-[12px] bg-amber-100 px-1.5 py-0.5 rounded">SUPABASE_SERVICE_KEY</code>{" "}
        in your Vercel project, then redeploy.
      </Banner>
    );
  }

  if (health === "no_schema") {
    const sqlUrl = supabaseSqlEditorUrl();
    return (
      <Banner
        tone="amber"
        icon={<Database className="h-4 w-4" />}
        action={sqlUrl ? { href: sqlUrl, label: "Open SQL editor" } : null}
      >
        <span className="font-semibold">Database is connected, but the schema isn&apos;t applied.</span>{" "}
        Open your{" "}
        {sqlUrl ? (
          <a className="font-semibold underline" target="_blank" rel="noreferrer" href={sqlUrl}>
            Supabase SQL editor
          </a>
        ) : (
          "Supabase SQL editor"
        )}
        , paste the contents of{" "}
        <a className="font-mono underline" target="_blank" rel="noreferrer" href={SCHEMA_GH_URL}>
          db/schema.sql
        </a>
        , and click <span className="font-semibold">Run</span>. Until you do, every dashboard mutation will fail.
      </Banner>
    );
  }

  return (
    <Banner tone="rose" icon={<AlertTriangle className="h-4 w-4" />} action={{ href: VERCEL_ENV_URL, label: "Open env vars" }}>
      <span className="font-semibold">Database error.</span>{" "}
      Could not reach Supabase. Check your env vars + that the service key has{" "}
      <code className="font-mono text-[12px] bg-rose-100 px-1.5 py-0.5 rounded">service_role</code> not{" "}
      <code className="font-mono text-[12px] bg-rose-100 px-1.5 py-0.5 rounded">anon</code>.
    </Banner>
  );
}

function Banner({
  tone,
  icon,
  action,
  children,
}: {
  tone: "amber" | "rose";
  icon: React.ReactNode;
  action: { href: string; label: string } | null;
  children: React.ReactNode;
}) {
  const styles =
    tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-rose-50 border-rose-200 text-rose-900";
  return (
    <div className={`border-b text-[13px] px-4 py-2.5 ${styles}`}>
      <div className="flex items-center justify-between gap-3 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-none">{icon}</span>
          <span className="truncate">{children}</span>
        </div>
        {action && (
          <a
            href={action.href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-semibold whitespace-nowrap hover:underline flex-none"
          >
            {action.label}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
