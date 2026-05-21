/**
 * team-grid.tsx — Section: people-led businesses introduce their team.
 *
 * Inputs:  data prop (SiteData) — reads data.team_members
 * Outputs: editorial team grid: 3-up large cards on lg, 2-up on md, 1-up on
 *          mobile. Each card has photo, name, role, optional short bio,
 *          and a brand-color accent rule on hover. No-ops if no members.
 * Used by: pages/index.astro when sections array includes "team-grid"
 *
 * Why this exists: salons, real-estate brokerages, fitness gyms, and law
 * firms are people-led — the operator IS the brand. A faceless "Services"
 * section doesn't earn trust the way meeting the stylist / agent / coach /
 * attorney does.
 */
import { motion } from "framer-motion";
import type { SiteData } from "../../lib/data";

export default function TeamGrid({ data }: { data: SiteData }) {
  const members = data.team_members ?? [];
  if (members.length === 0) return null;

  return (
    <section className="container-tight py-20 md:py-24" id="team">
      <div className="max-w-2xl mb-12 md:mb-16">
        <span className="eyebrow">The people</span>
        <h2 className="mt-3 text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tighter-2 text-ink leading-[1.05]">
          Meet the team behind the work.
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
        {members.map((m, i) => (
          <motion.article
            key={m.name}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, delay: i * 0.08, ease: [0.2, 0.7, 0.2, 1] }}
            className="group"
          >
            <div className="relative aspect-[4/5] overflow-hidden mb-4 ring-1 ring-ink/5">
              <img
                src={m.photo}
                alt={`${m.name}, ${m.role}`}
                loading="lazy"
                width={800}
                height={1000}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
              {/* Hover accent rule — paints the bottom of the photo with
                  brand color, telegraphing interactivity without going full
                  generic-card-hover. */}
              <div
                className="absolute inset-x-0 bottom-0 h-1 transform scale-x-0 origin-left transition-transform duration-500 group-hover:scale-x-100"
                style={{
                  background:
                    "linear-gradient(90deg, rgb(var(--c-primary)) 0%, rgb(var(--c-accent)) 100%)",
                }}
                aria-hidden
              />
            </div>
            <div className="space-y-1">
              <h3
                className="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-ink leading-none"
                style={{ fontVariationSettings: '"opsz" 144' }}
              >
                {m.name}
              </h3>
              <div
                className="text-[11px] font-bold tracking-[0.22em] uppercase"
                style={{ color: "rgb(var(--c-primary))" }}
              >
                {m.role}
              </div>
              {m.bio_short && (
                <p className="text-sm text-ink-muted leading-relaxed pt-2 max-w-sm">
                  {m.bio_short}
                </p>
              )}
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
