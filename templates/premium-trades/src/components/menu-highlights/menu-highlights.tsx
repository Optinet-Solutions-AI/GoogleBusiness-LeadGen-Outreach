/**
 * menu-highlights.tsx — Section: restaurant menu featured items.
 *
 * Inputs:  data prop (SiteData) — reads data.menu_highlights
 * Outputs: chalkboard-meets-magazine menu layout. Each item: bold name,
 *          dotted leader line, price (tabular-nums), short description.
 *          Optional photo for "hero" items renders inline. No-ops empty.
 * Used by: pages/index.astro when sections array includes "menu-highlights"
 *
 * Why this exists: a restaurant doesn't have "services" — it has a menu.
 * The visual grammar of a menu (the leader-dots, the typography, the way
 * the price hangs at the right edge) signals "food business" in a way no
 * service-card grid ever will.
 */
import { motion } from "framer-motion";
import type { SiteData } from "../../lib/data";

export default function MenuHighlights({ data }: { data: SiteData }) {
  const items = data.menu_highlights ?? [];
  if (items.length === 0) return null;

  return (
    <section className="py-20 md:py-24" id="menu">
      <div className="container-tight">
        <div className="text-center max-w-2xl mx-auto mb-12 md:mb-16">
          <span className="eyebrow">Featured menu</span>
          <h2
            className="mt-3 text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tighter-2 text-ink leading-[1.05]"
            style={{ fontVariationSettings: '"opsz" 144' }}
          >
            What people line up for.
          </h2>
          <p className="mt-5 text-base text-ink-muted leading-relaxed">
            A small selection of the staples. Full menu in-store.
          </p>
        </div>

        <ul className="max-w-3xl mx-auto space-y-7 md:space-y-9">
          {items.map((item, i) => (
            <motion.li
              key={item.name}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.55, delay: i * 0.06 }}
              className="flex gap-5 items-start"
            >
              {item.photo && (
                <div className="hidden md:block shrink-0 w-24 h-24 rounded-full overflow-hidden ring-2"
                  style={{ borderColor: "rgb(var(--c-accent))" }}
                >
                  <img
                    src={item.photo}
                    alt={item.name}
                    loading="lazy"
                    width={200}
                    height={200}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                {/* Top row: name + leader dots + price */}
                <div className="flex items-baseline gap-3">
                  <h3
                    className="font-heading text-xl md:text-2xl lg:text-3xl font-semibold tracking-tight text-ink whitespace-nowrap"
                    style={{ fontVariationSettings: '"opsz" 144' }}
                  >
                    {item.name}
                  </h3>
                  <span
                    className="flex-1 border-b border-dotted self-end mb-1.5"
                    style={{ borderColor: "rgb(var(--c-neutral-900) / 0.3)" }}
                    aria-hidden
                  />
                  {item.price && (
                    <span
                      className="font-heading text-lg md:text-xl font-semibold tabular-nums tracking-tight whitespace-nowrap"
                      style={{ color: "rgb(var(--c-primary))" }}
                    >
                      {item.price}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm md:text-base text-ink-muted leading-relaxed">
                  {item.description}
                </p>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
