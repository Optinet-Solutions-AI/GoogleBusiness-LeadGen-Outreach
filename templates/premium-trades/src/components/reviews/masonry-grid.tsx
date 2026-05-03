/**
 * masonry-grid.tsx — Reviews variant: Pinterest-style staggered grid.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: 3-col masonry layout of all available reviews. Each card varies
 *          slightly in height (CSS columns). Reads as a wall of social
 *          proof, not a marquee that could feel "stock-y".
 * Used by: pages/index.astro when variants.reviews === 'masonry-grid'
 *
 * Pick rule: best when the lead has 6+ real reviews — the wall makes the
 * volume itself the message. For sparse-review leads, fall back to the
 * marquee variant which animates 2-3 cards into a busier visual.
 */
import { motion } from "framer-motion";
import { Star, Quote } from "lucide-react";
import type { SiteData, ReviewItem } from "../../lib/data";
import { initials } from "../../lib/format";

function ReviewCard({ r, index }: { r: ReviewItem; index: number }) {
  const author = r.author ?? "Customer";
  const text = r.text ?? "";
  const rating = r.rating ?? 5;
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: 0.04 * index }}
      className="break-inside-avoid mb-5 bg-surface rounded-3xl p-6 md:p-7 shadow-xl shadow-ink/5 ring-1 ring-ink/5"
    >
      <Quote size={28} className="text-brand/30" />
      <p className="mt-3 text-ink leading-relaxed">"{text}"</p>
      <div className="mt-5 flex items-center gap-3">
        <div className="grid place-items-center w-10 h-10 rounded-full bg-brand/10 text-brand text-sm font-bold flex-none">
          {initials(author)}
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">{author}</div>
          <div className="flex">
            {Array.from({ length: rating }).map((_, i) => (
              <Star key={i} size={11} className="text-amber-400" fill="currentColor" strokeWidth={0} />
            ))}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

export default function ReviewsMasonryGrid({ data }: { data: SiteData }) {
  const reviews = data.reviews.filter((r) => r.text && r.text.length > 20);
  if (reviews.length < 3) return null;

  return (
    <section className="py-24 bg-surface-alt" id="reviews">
      <div className="container-tight">
        <div className="max-w-2xl mb-12">
          <span className="eyebrow">Word of mouth</span>
          <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
            What neighbors say
          </h2>
          <p className="mt-4 text-lg text-ink-muted">{data.copy.social_proof_line}</p>
        </div>

        {/* CSS columns produces masonry without JS — perfect for Lighthouse. */}
        <div className="columns-1 md:columns-2 lg:columns-3 gap-5">
          {reviews.slice(0, 9).map((r, i) => (
            <ReviewCard key={i} r={r} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
