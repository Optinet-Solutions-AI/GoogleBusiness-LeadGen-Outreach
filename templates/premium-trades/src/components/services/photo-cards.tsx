/**
 * photo-cards.tsx — Services variant: equal-weight cards each with photo bg.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: 3-4 services as a uniform grid of large photo-backed cards. Each
 *          card has a stock photo background (different per card from the
 *          niche pool), gradient overlay, name + description, hover lift.
 * Used by: pages/index.astro when variants.services === 'photo-cards'
 *
 * Pick rule: best for service businesses where each service is genuinely
 * distinct and benefits from its own visual (estate sales, beauty, salons,
 * food). Solves the "bento card 2 + 3 are hollow" problem from the bento
 * variant. Cards are equal-weight by design — the visual draw is the photo.
 */
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { SiteData } from "../../lib/data";

export default function PhotoCardsServices({ data }: { data: SiteData }) {
  const services = data.copy.services;
  const photos = data.photos;
  if (!services.length) return null;

  return (
    <section className="container-tight py-24" id="services">
      <div className="flex items-end justify-between gap-6 flex-wrap mb-12">
        <div className="max-w-2xl">
          <span className="eyebrow">What we do</span>
          <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
            Crafted for {data.address?.split(",").slice(-2, -1)[0]?.trim() ?? "your home"}
          </h2>
        </div>
        <a href="/contact" className="btn-secondary text-sm hidden md:inline-flex">
          Not sure which? Ask us <ArrowUpRight size={16} />
        </a>
      </div>

      <div
        className={[
          "grid gap-5",
          // 1 = full width; 2 = side by side; 3+ = 3-up
          services.length === 1 ? "" : services.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3",
        ].join(" ")}
      >
        {services.map((s, i) => {
          // Each card grabs a distinct photo (cycling through the pool).
          const bg = photos[(i + 1) % Math.max(photos.length, 1)] ?? photos[0];
          return (
            <motion.a
              key={s.slug}
              href={`/services/${s.slug}`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: 0.05 * i }}
              className="group relative overflow-hidden rounded-3xl bg-ink min-h-[420px] flex flex-col justify-end p-7 md:p-8 hover:-translate-y-1 transition-all"
            >
              {bg && (
                <img
                  src={bg}
                  alt=""
                  width={1200}
                  height={900}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding={i === 0 ? "sync" : "async"}
                  className="absolute inset-0 w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-700"
                />
              )}
              {/* Bottom-up gradient for legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/55 to-ink/10" />

              <div className="relative">
                <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight">
                  {s.name}
                </h3>
                <p className="mt-3 text-white/80 leading-relaxed line-clamp-3">
                  {s.short_description}
                </p>
                <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
                  Learn more
                  <ArrowUpRight
                    size={16}
                    className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </div>
              </div>
            </motion.a>
          );
        })}
      </div>
    </section>
  );
}
