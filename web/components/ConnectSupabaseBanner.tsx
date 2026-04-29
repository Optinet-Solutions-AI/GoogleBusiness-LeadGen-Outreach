/**
 * ConnectSupabaseBanner.tsx — yellow banner shown in the dashboard header
 * when Supabase env vars aren't set in the deployment.
 *
 * Renders only when NOT configured — invisible once env vars are present.
 */

import { AlertTriangle, ExternalLink } from "lucide-react";
import { isDbConfigured } from "@/lib/safe-db";

export function ConnectSupabaseBanner() {
  if (isDbConfigured()) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-[13px] px-4 py-2.5">
      <div className="flex items-center justify-between gap-3 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="h-4 w-4 flex-none" strokeWidth={2.25} />
          <span className="truncate">
            <span className="font-semibold">Supabase not configured.</span>{" "}
            Set <code className="font-mono text-[12px] bg-amber-100 px-1.5 py-0.5 rounded">SUPABASE_URL</code> +{" "}
            <code className="font-mono text-[12px] bg-amber-100 px-1.5 py-0.5 rounded">SUPABASE_SERVICE_KEY</code> in your Vercel project. The dashboard renders, but no real data flows until you do.
          </span>
        </div>
        <a
          href="https://vercel.com/optinet-solutions-ais-andbox/google-business-lead-gen-outreach/settings/environment-variables"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 font-semibold whitespace-nowrap hover:underline flex-none"
        >
          Open env vars
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
