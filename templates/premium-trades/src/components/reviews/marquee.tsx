/**
 * marquee.tsx — Reviews section variant: edge-to-edge horizontal marquee.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: section header + two-row marquee of review cards (rows scroll
 *          opposite directions for visual depth). Pauses on hover.
 * Used by: pages/index.astro when variants.reviews === 'marquee'
 */
import { motion } from "framer-motion";
import { Star, Quote } from "lucide-react";
import type { SiteData, ReviewItem } from "../../lib/data";
import { initials } from "../../lib/format";

function ReviewCard({ r }: { r: ReviewItem }) {
  const author = r.author ?? "Customer";
  const text = r.text ?? "";
  const rating = r.rating ?? 5;
  return (
    <article className="w-[320px] md:w-[380px] flex-none bg-surface rounded-3xl p-6 md:p-7 shadow-xl shadow-ink/5 ring-1 ring-ink/5">
      <Quote size={28} className="text-brand/30" />
      <p className="mt-3 text-ink leading-relaxed line-clamp-5">"{text}"</p>
      <div className="mt-5 flex items-center gap-3">
        <div className="grid place-items-center w-10 h-10 rounded-full bg-brand/10 text-brand text-sm font-bold">
          {initials(author)}
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">{author}</div>
          <div className="flex">
            {Array.from({ length: rating }).map((_, i) => (
              <Star key={i} size={12} className="text-amber-400" fill="currentColor" strokeWidth={0} />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function ReviewsMarquee({ data }: { data: SiteData }) {
  const reviews = data.reviews.filter((r) => r.text && r.text.length > 20);
  if (reviews.length < 2) return null;

  // Two rows. Split + duplicate so the marquee loop is seamless.
  const half = Math.ceil(reviews.length / 2);
  const rowA = [...reviews.slice(0, half), ...reviews.slice(0, half)];
  const rowB = [...reviews.slice(half), ...reviews.slice(half)];

  return (
    <section className="py-24 bg-surface-alt overflow-hidden" id="reviews">
      <div className="container-tight">
        <div className="max-w-2xl">
          <span className="eyebrow">Word of mouth</span>
          <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
            What neighbors say
          </h2>
          <p className="mt-4 text-lg text-ink-muted">{data.copy.social_proof_line}</p>
        </div>
      </div>

      <div className="mt-12 space-y-6 group">
        <div className="relative overflow-hidden">
          <motion.div
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
            className="flex gap-5 pr-5 group-hover:[animation-play-state:paused]"
            style={{ width: "max-content" }}
          >
            {rowA.map((r, i) => <ReviewCard key={`a-${i}`} r={r} />)}
          </motion.div>
        </div>
        {rowB.length > 0 && (
          <div className="relative overflow-hidden">
            <motion.div
              animate={{ x: ["-50%", "0%"] }}
              transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
              className="flex gap-5 pr-5 group-hover:[animation-play-state:paused]"
              style={{ width: "max-content" }}
            >
              {rowB.map((r, i) => <ReviewCard key={`b-${i}`} r={r} />)}
            </motion.div>
          </div>
        )}
      </div>
    </section>
  );
}
