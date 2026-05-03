/**
 * single-featured.tsx — Reviews variant: one editorial pull-quote.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: one large featured review centered with oversized quote marks,
 *          author + 5 stars, plus 2 supporting smaller cards below.
 * Used by: pages/index.astro when variants.reviews === 'single-featured'
 *
 * Pick rule: best when the lead has 1-2 strong reviews (e.g. service-area
 * businesses with low review counts) — leaning into ONE great review reads
 * more confident than padding a grid with thin ones.
 */
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { initials } from "../../lib/format";

export default function ReviewsSingleFeatured({ data }: { data: SiteData }) {
  const reviews = data.reviews.filter((r) => r.text && r.text.length > 20);
  if (reviews.length === 0) return null;

  const [featured, ...supporting] = reviews;

  return (
    <section className="py-24 bg-surface-alt" id="reviews">
      <div className="container-tight">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <span className="eyebrow">Word of mouth</span>
          <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
            What neighbors say
          </h2>
        </div>

        {/* Hero quote */}
        <motion.figure
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center"
        >
          <span aria-hidden className="font-heading text-[120px] md:text-[160px] leading-none text-brand/30 select-none block -mb-8 md:-mb-12">"</span>
          <blockquote className="text-2xl md:text-3xl lg:text-4xl text-ink font-medium leading-snug tracking-tight">
            {featured.text}
          </blockquote>
          <figcaption className="mt-8 inline-flex items-center gap-3">
            <div className="grid place-items-center w-12 h-12 rounded-full bg-brand text-brand-text font-bold flex-none">
              {initials(featured.author ?? "Customer")}
            </div>
            <div className="text-left">
              <div className="font-semibold text-ink">{featured.author ?? "Customer"}</div>
              <div className="flex">
                {Array.from({ length: featured.rating ?? 5 }).map((_, i) => (
                  <Star key={i} size={14} className="text-amber-400" fill="currentColor" strokeWidth={0} />
                ))}
              </div>
            </div>
          </figcaption>
        </motion.figure>

        {/* Supporting reviews */}
        {supporting.length > 0 && (
          <div className="mt-20 grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {supporting.slice(0, 2).map((r, i) => (
              <motion.article
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 * i }}
                className="bg-surface rounded-3xl p-6 shadow-xl shadow-ink/5 ring-1 ring-ink/5"
              >
                <div className="flex">
                  {Array.from({ length: r.rating ?? 5 }).map((_, j) => (
                    <Star key={j} size={12} className="text-amber-400" fill="currentColor" strokeWidth={0} />
                  ))}
                </div>
                <p className="mt-3 text-ink leading-relaxed line-clamp-4">"{r.text}"</p>
                <div className="mt-4 text-sm font-semibold text-ink-muted">
                  — {r.author ?? "Customer"}
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
