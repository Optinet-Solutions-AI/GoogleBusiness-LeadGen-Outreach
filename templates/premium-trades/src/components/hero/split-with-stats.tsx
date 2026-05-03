/**
 * split-with-stats.tsx — Hero variant: split layout with key stats / proof.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: 2-column hero. Left: eyebrow + headline + subhead + dual CTAs +
 *          a 3-up stat row (years / reviews / rating). Right: a clean single
 *          large photo (NOT a collage — feels more grounded than parallax).
 * Used by: pages/index.astro when variants.hero === 'split-with-stats'
 *
 * Pick rule: best for trust-heavy professional services where social proof
 * is the lever (lawyers, accountants, financial, contractors with high
 * review counts). Reads as a confident "we've done this many times" hero.
 */
import { motion } from "framer-motion";
import { Phone, Star, ArrowRight, ShieldCheck } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { telHref } from "../../lib/format";

interface Stat {
  value: string;
  label: string;
}

function deriveStats(data: SiteData): Stat[] {
  const stats: Stat[] = [];
  if (data.review_count && data.review_count >= 10) {
    stats.push({ value: `${data.review_count}+`, label: "Five-star reviews" });
  }
  if (data.rating) {
    stats.push({ value: data.rating.toFixed(1), label: "Google rating" });
  }
  // Always include a service-area count — it's the third "we cover ground" beat.
  if (data.service_areas && data.service_areas.length) {
    stats.push({
      value: `${data.service_areas.length}+`,
      label: data.service_areas.length === 1 ? "Local area" : "Local areas",
    });
  }
  // Pad with a defensive trust beat if we ended up short.
  while (stats.length < 3) {
    stats.push({ value: "100%", label: "Local & owner-run" });
    break;
  }
  return stats.slice(0, 3);
}

export default function SplitWithStatsHero({ data }: { data: SiteData }) {
  const c = data.copy;
  const heroImg = data.photos[0];
  const stats = deriveStats(data);

  return (
    <section className="relative overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, rgb(var(--c-surface-alt)) 0%, rgb(var(--c-surface)) 100%)",
        }}
      />
      <div className="container-tight pt-16 pb-20 md:pt-24 md:pb-28 grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        {/* LEFT: copy + CTAs + stats */}
        <div className="lg:col-span-6">
          <motion.span
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="eyebrow"
          >
            {data.category ?? "Local Service"}
            {data.address?.split(",").slice(-2, -1)[0]?.trim() && (
              <span className="text-ink-muted"> · {data.address.split(",").slice(-2, -1)[0].trim()}</span>
            )}
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-4 text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tighter-2 leading-tight-2 text-ink"
          >
            {c.hero_tagline}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-6 text-lg md:text-xl text-ink-muted leading-relaxed"
          >
            {c.hero_subhead}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <a href="/contact" className="btn-primary text-base">
              {c.cta_primary}
              <ArrowRight size={16} />
            </a>
            {data.phone && (
              <a href={telHref(data.phone)} className="btn-secondary text-base">
                <Phone size={16} aria-hidden /> {c.cta_secondary}
              </a>
            )}
          </motion.div>

          {/* Stat row — three confident beats */}
          <motion.dl
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-12 grid grid-cols-3 gap-4 max-w-md"
          >
            {stats.map((s, i) => (
              <div
                key={i}
                className="flex flex-col gap-1 pl-4 border-l-2 border-brand/30"
              >
                <dt className="font-semibold text-3xl md:text-4xl text-ink tracking-tight">{s.value}</dt>
                <dd className="text-xs text-ink-muted leading-tight">{s.label}</dd>
              </div>
            ))}
          </motion.dl>
        </div>

        {/* RIGHT: single large premium photo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="lg:col-span-6 relative"
        >
          {heroImg && (
            <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-ink/15 ring-1 ring-ink/5 aspect-[4/5] lg:aspect-[3/4]">
              <img
                src={heroImg}
                alt=""
                width={1200}
                height={1500}
                fetchPriority="high"
                decoding="sync"
                className="w-full h-full object-cover"
              />
              {/* Floating trust chip — bottom left */}
              <div className="absolute bottom-5 left-5 right-5 sm:right-auto bg-surface/95 backdrop-blur rounded-2xl px-5 py-4 shadow-2xl shadow-ink/20 border border-ink/5 flex items-center gap-3">
                <div className="grid place-items-center w-10 h-10 rounded-xl bg-brand text-brand-text flex-none">
                  <ShieldCheck size={18} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink truncate">
                    {data.business_name}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <div className="flex">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          size={11}
                          className="text-amber-400"
                          fill="currentColor"
                          strokeWidth={0}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-ink-muted ml-1">{c.urgency_micro}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}
