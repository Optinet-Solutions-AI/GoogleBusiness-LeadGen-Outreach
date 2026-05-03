/**
 * minimal-list.tsx — Services variant: refined editorial list.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: numbered/bulleted vertical list of services. Each row: large
 *          number, name, description, key bullets, "see details" link.
 *          Reads as a magazine table of contents.
 * Used by: pages/index.astro when variants.services === 'minimal-list'
 *
 * Pick rule: best for professional services where photos would feel
 * out-of-place — lawyers, accountants, consultants, financial advisors,
 * insurance, marketing agencies. The text-first layout signals seriousness.
 */
import { motion } from "framer-motion";
import { ArrowUpRight, Check } from "lucide-react";
import type { SiteData } from "../../lib/data";

export default function MinimalListServices({ data }: { data: SiteData }) {
  const services = data.copy.services;
  if (!services.length) return null;

  return (
    <section className="container-tight py-24" id="services">
      <div className="max-w-2xl mb-16">
        <span className="eyebrow">What we do</span>
        <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
          Practice areas
        </h2>
        <p className="mt-4 text-lg text-ink-muted">
          Focused expertise, clearly priced, delivered on time.
        </p>
      </div>

      <ol className="divide-y divide-ink/10">
        {services.map((s, i) => (
          <motion.li
            key={s.slug}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: 0.05 * i }}
            className="py-10 grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10"
          >
            <div className="md:col-span-1 text-2xl md:text-4xl font-semibold text-brand/40 tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="md:col-span-5">
              <a href={`/services/${s.slug}`} className="group inline-flex items-baseline gap-2">
                <h3 className="text-2xl md:text-3xl font-bold text-ink tracking-tight group-hover:text-brand transition-colors">
                  {s.name}
                </h3>
                <ArrowUpRight
                  size={18}
                  className="text-ink-muted group-hover:text-brand group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                />
              </a>
              <p className="mt-3 text-ink-muted leading-relaxed">{s.short_description}</p>
            </div>
            <div className="md:col-span-6">
              <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {s.bullets.slice(0, 4).map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-ink leading-snug">
                    <Check size={14} className="mt-1 flex-none text-brand" strokeWidth={2.5} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.li>
        ))}
      </ol>

      <div className="mt-16 flex justify-center">
        <a href="/contact" className="btn-primary text-base">
          {data.copy.cta_primary}
          <ArrowUpRight size={16} />
        </a>
      </div>
    </section>
  );
}
