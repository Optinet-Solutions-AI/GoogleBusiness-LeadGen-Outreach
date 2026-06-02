/**
 * (dashboard)/replies/page.tsx — Legacy redirect.
 *
 * Inputs:  none
 * Outputs: 307 redirect → /inbox
 * Used by: old bookmarks / links to /replies
 */

import { redirect } from "next/navigation";

export default function RepliesPage() {
  redirect("/inbox");
}
