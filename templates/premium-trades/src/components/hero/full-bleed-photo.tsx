/**
 * full-bleed-photo.tsx — Hero variant: cinematic full-bleed background photo.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: full-viewport-width hero with photos[0] as background, gradient
 *          overlay for text legibility, headline + subhead + dual CTAs
 *          + rating chip stacked over the image.
 * Used by: pages/index.astro when variants.hero === 'full-bleed-photo'
 *
 * Pick rule: best for businesses with a single STRONG hero image —
 * boutiques, restaurants, real estate, beauty/wellness, professional spaces.
 * Reads as a magazine cover instead of a SaaS landing page.
 */
import { motion } from "framer-motion";
import { Phone, ArrowRight } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { telHref, headlineLocation } from "../../lib/format";

export default function FullBleedPhotoHero({ data }: { data: SiteData }) {
  const c = data.copy;
  const heroImg = data.photos[0];
  const city = headlineLocation(data.address);

  return (
    <section className="relative min-h-[640px] md:min-h-[760px] flex items-end overflow-hidden">
      {/* Background photo — fetchpriority on the <img> drops LCP. */}
      {heroImg && (
        <img
          src={heroImg}
          alt=""
          width={2400}
          height={1600}
          fetchPriority="high"
          decoding="sync"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {/* Dark gradient overlay — strongest at the bottom where the copy lives. */}
      <div className="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/55 to-ink/15" />
      {/* Subtle vignette for cinematic depth */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.35)_100%)]" />

      <div className="relative container-tight w-full pt-32 pb-16 md:pt-44 md:pb-24">
        {/* Eyebrow — city only. data.category is the raw Google taxonomy
            slug (HOME_GOODS_STORE etc.) which reads like a database key,
            not a brand statement; we drop it everywhere. */}
        {city && (
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-block text-xs font-semibold uppercase tracking-[0.2em] text-white/80"
          >
            {city}
          </motion.span>
        )}

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-4 text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-semibold tracking-tighter-2 leading-tight-2 text-white max-w-4xl drop-shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
        >
          {c.hero_tagline}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18 }}
          className="mt-6 max-w-2xl text-lg md:text-xl text-white/85 leading-relaxed"
        >
          {c.hero_subhead}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.28 }}
          className="mt-10 flex flex-wrap items-center gap-4"
        >
          <a
            href="/contact"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-brand text-brand-text font-semibold shadow-2xl shadow-brand/30 hover:-translate-y-0.5 transition-all"
          >
            {c.cta_primary}
            <ArrowRight size={16} />
          </a>
          {data.phone && (
            <a
              href={telHref(data.phone)}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full border border-white/30 text-white font-semibold backdrop-blur hover:bg-white/10 transition-all"
            >
              <Phone size={16} />
              {c.cta_secondary}
            </a>
          )}
        </motion.div>

        {/* Rating chip removed — dedicated reviews section carries that
            signal more authoritatively than a 4.2-star floating badge. */}
      </div>
    </section>
  );
}
