/**
 * (dashboard)/calls/page.tsx — retired.
 *
 * The flat "call queue" is superseded by campaign-organized calling. This route
 * redirects to /campaigns so old links/funnel clicks still land somewhere valid.
 */
import { redirect } from "next/navigation";

export default function CallsPage() {
  redirect("/campaigns");
}
