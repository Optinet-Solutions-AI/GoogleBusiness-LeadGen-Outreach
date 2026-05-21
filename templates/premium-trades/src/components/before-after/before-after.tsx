/**
 * before-after.tsx — Section: paired-image proof for transformation work.
 *
 * Inputs:  data prop (SiteData) — reads data.before_after
 * Outputs: section that displays each pair as a side-by-side comparison
 *          with "BEFORE" / "AFTER" labels stamped at the top-left of each
 *          image, plus an optional caption beneath. 2-up grid on lg, 1-up
 *          stacked on mobile. No-ops if no pairs.
 * Used by: pages/index.astro when sections array includes "before-after"
 *
 * Why this exists: salons (color/cut), fitness (body comp), landscaping,
 * remodel/contractor, and dental are transformation businesses. Their
 * single strongest visual proof is what something looked like before vs
 * after. Reviews and ratings are abstract — paired photos are concrete.
 */
import { motion } from "framer-motion";
import type { SiteData } from "../../lib/data";

export default function BeforeAfter({ data }: { data: SiteData }) {
  const pairs = data.before_after ?? [];
  if (pairs.length === 0) return null;

  return (
    <section className="py-20 md:py-24 bg-surface-alt" id="before-after">
      <div className="container-tight">
        <div className="max-w-2xl mb-12 md:mb-16">
          <span className="eyebrow">Before / After</span>
          <h2 className="mt-3 text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tighter-2 text-ink leading-[1.05]">
            What the work actually looks like.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10">
          {pairs.map((pair, i) => (
            <motion.div
              key={`${pair.before_photo}-${i}`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: i * 0.1 }}
            >
              <div className="grid grid-cols-2 gap-2 md:gap-3">
                <Stage label="Before" photo={pair.before_photo} accent="muted" />
                <Stage label="After" photo={pair.after_photo} accent="bold" />
              </div>
              {pair.caption && (
                <p className="mt-4 text-sm md:text-base text-ink-muted leading-relaxed">
                  {pair.caption}
                </p>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stage({
  label,
  photo,
  accent,
}: {
  label: string;
  photo: string;
  accent: "muted" | "bold";
}) {
  const stampStyle =
    accent === "bold"
      ? {
          background: "rgb(var(--c-accent))",
          color: "rgb(var(--c-primary-text))",
        }
      : {
          background: "rgb(var(--c-neutral-900) / 0.85)",
          color: "rgb(var(--c-surface))",
        };

  return (
    <div className="relative aspect-[4/5] overflow-hidden ring-1 ring-ink/5">
      <img
        src={photo}
        alt={`${label}`}
        loading="lazy"
        width={800}
        height={1000}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <span
        className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-bold tracking-[0.22em] uppercase"
        style={stampStyle}
      >
        {label}
      </span>
    </div>
  );
}
