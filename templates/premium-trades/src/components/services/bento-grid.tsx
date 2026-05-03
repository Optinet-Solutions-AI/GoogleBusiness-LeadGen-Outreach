/**
 * bento-grid.tsx — Services section variant: asymmetric bento card layout.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: section header + N service cards in a bento (varied sizes) grid.
 *          First card is the hero (2 cols on desktop), rest are uniform.
 * Used by: pages/index.astro when variants.services === 'bento-grid'
 */
import { motion } from "framer-motion";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { SiteData } from "../../lib/data";

export default function BentoGrid({ data }: { data: SiteData }) {
  const services = data.copy.services;
  const photos = data.photos;
  if (!services.length) return null;

  const [hero, ...rest] = services;

  return (
    <section className="container-tight py-24 cv-auto" id="services">
      <div className="flex items-end justify-between gap-6 flex-wrap mb-12">
        <div>
          <span className="eyebrow">What we do</span>
          <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
            Services built for {data.address?.split(",").slice(-2, -1)[0]?.trim() ?? "your home"}
          </h2>
        </div>
        <a href="/contact" className="btn-secondary text-sm hidden md:inline-flex">
          Not sure which? Ask us <ArrowUpRight size={16} />
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 auto-rows-[minmax(220px,auto)]">
        {/* Hero card */}
        <motion.a
          href={`/services/${hero.slug}`}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="md:col-span-2 md:row-span-2 group relative overflow-hidden rounded-3xl bg-ink text-white p-8 md:p-10 flex flex-col justify-between min-h-[460px]"
        >
          {photos[0] && (
            <img
              src={photos[0]}
              alt=""
              width={1200}
              height={800}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 group-hover:scale-105 transition-all duration-700"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/30" />
          <div className="relative">
            <span className="inline-block text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
              Featured
            </span>
            <h3 className="mt-3 text-3xl md:text-4xl font-bold leading-tight">{hero.name}</h3>
            <p className="mt-4 text-white/80 max-w-md leading-relaxed">{hero.short_description}</p>
          </div>
          <div className="relative mt-8">
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {hero.bullets.slice(0, 4).map((b) => (
                <div key={b} className="flex items-start gap-2 text-sm text-white/90">
                  <CheckCircle2 size={16} className="mt-0.5 flex-none text-accent" />
                  <span>{b}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold">
              See details <ArrowUpRight size={16} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </div>
          </div>
        </motion.a>

        {/* Rest of services */}
        {rest.map((s, i) => (
          <motion.a
            key={s.slug}
            href={`/services/${s.slug}`}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: 0.05 * (i + 1) }}
            className="group relative overflow-hidden rounded-3xl bg-surface-alt p-6 md:p-8 flex flex-col justify-between hover:-translate-y-1 hover:shadow-2xl hover:shadow-ink/10 transition-all"
          >
            <div>
              <div className="grid place-items-center w-12 h-12 rounded-2xl bg-brand text-brand-text">
                <CheckCircle2 size={22} />
              </div>
              <h3 className="mt-5 text-xl md:text-2xl font-bold tracking-tight text-ink">{s.name}</h3>
              <p className="mt-2 text-ink-muted leading-relaxed">{s.short_description}</p>
            </div>
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand">
              Learn more
              <ArrowUpRight size={16} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </div>
          </motion.a>
        ))}
      </div>
    </section>
  );
}
