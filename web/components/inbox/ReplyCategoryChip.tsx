/**
 * inbox/ReplyCategoryChip.tsx — the AI's read of a reply as a small chip ("Interested", "Question", …).
 *
 * Inputs:  a reply category (lib/email/reply-ai.ts) or null
 * Outputs: the chip; nothing when there's no category
 * Used by: components/inbox/InboxClient.tsx (list rows), components/inbox/ReplyAiBox.tsx (thread)
 *
 * Dumb. Interested / Question stand out (they're answered first).
 */
import { CATEGORY_LABEL, isReplyCategory, isTopCategory } from "@/lib/email/reply-ai";

export function ReplyCategoryChip({ category }: { category: string | null | undefined }) {
  if (!isReplyCategory(category)) return null;
  const tone = isTopCategory(category)
    ? "bg-positive text-white"
    : category === "stop" || category === "not_interested"
      ? "bg-surface-alt text-ink-muted"
      : "bg-warning-soft text-warning";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`} title="How the AI read their reply">
      {CATEGORY_LABEL[category]}
    </span>
  );
}
