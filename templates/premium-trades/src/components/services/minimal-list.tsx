/**
 * minimal-list.tsx — Services variant: refined editorial list with photo
 * accent per service.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: numbered vertical list of services. Each row: small square
 *          photo thumbnail + large number + name + description + key
 *          bullets + "see details" link. Reads as a magazine table of
 *          contents — restrained, editorial, but visually present.
 * Used by: pages/index.astro when variants.services === 'minimal-list'
 *
 * Pick rule: best when the operator wants restraint — photos are present
 * but small accents, not the focus. Works for boutique law, vintage,
 * consultants, financial. The original (photo-less) version felt empty
 * on photo-rich niches (vintage, beauty) and identical across leads;
 * adding the thumbnail brings parity with photo-cards/mixed-cards while
 * preserving the editorial tone.
 */
import { motion } from "framer-motion";
import { ArrowUpRight, Check, MapPin } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { resolveServicesHeadline } from "../../lib/format";

export default function MinimalListServices({ data }: { data: SiteData }) {
  const services = data.copy.services;
  const photos = data.photos;
  if (!services.length) return null;

  const eyebrow = data.copy.services_eyebrow ?? "What we do";
  const headline = resolveServicesHeadline(data.copy.services_headline_template, data.address);

  return (
    <section className="container-tight py-24" id="services">
      <div className="max-w-2xl mb-16">
        <span className="eyebrow inline-flex items-center gap-1.5">
          <MapPin size={11} aria-hidden /> {eyebrow}
        </span>
        <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
          {headline}
        </h2>
        <p className="mt-4 text-lg text-ink-muted">{data.copy.service_area_intro}</p>
      </div>

      <ol className="divide-y divide-ink/10">
        {services.map((s, i) => {
          // Each service grabs a distinct photo. Cycle from index+1 so
          // photos[0] (the hero) doesn't double up at service[0].
          const photo = photos[(i + 1) % Math.max(photos.length, 1)] ?? photos[0] ?? null;
          return (
            <motion.li
              key={s.slug}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: 0.05 * i }}
              className="py-10 grid grid-cols-[auto_1fr] md:grid-cols-12 gap-5 md:gap-10 items-start"
            >
              {/* Photo thumbnail + number — stacked on mobile/desktop. */}
              <div className="md:col-span-2 flex items-start gap-4">
                {photo && (
                  <div className="w-20 h-20 md:w-24 md:h-24 shrink-0 rounded-2xl overflow-hidden bg-surface-alt ring-1 ring-ink/5">
                    <img
                      src={photo}
                      alt=""
                      width={200}
                      height={200}
                      loading={i === 0 ? "eager" : "lazy"}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div
                  className="font-heading text-3xl md:text-4xl font-semibold tabular-nums leading-none mt-1"
                  style={{ color: "rgb(var(--c-primary) / 0.5)" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
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

              <div className="md:col-span-5 col-span-2 md:col-start-auto">
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
          );
        })}
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
