/**
 * mixed-cards.tsx — Services variant where each card has its own layout.
 *
 * Inputs:  data prop (SiteData)
 * Outputs: 3–4 services rendered in an asymmetric magazine grid where
 *          each card has a structurally different shape — feature card,
 *          photo-stack, text-led pull-quote, compact horizontal. Reads
 *          as a curated set rather than the uniform grid you get from
 *          photo-cards (every service shaped identically).
 * Used by: pages/index.astro when variants.services === 'mixed-cards'
 *
 * Pick rule: best when the operator wants the page to feel hand-laid-out
 * rather than generated. The cross-lead diversity picker prefers this
 * variant when a same-niche neighbor already used 'photo-cards' or
 * 'bento-grid', breaking the "every service-business site shows the
 * same uniform grid of cards" pattern.
 *
 * Card-type rotation by index:
 *   0 → feature      (spans 2 cols on lg, large photo bg, big headline)
 *   1 → photo-stack  (photo top + text below, single col)
 *   2 → text-led     (no photo, brand-color rule + serif pull-quote)
 *   3 → compact      (spans full width on lg, photo left + text right)
 *   4+ → cycles back to feature
 */
import { motion } from "framer-motion";
import { ArrowUpRight, Quote } from "lucide-react";
import type { SiteData } from "../../lib/data";

type Service = SiteData["copy"]["services"][number];

export default function MixedCardsServices({ data }: { data: SiteData }) {
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

      {/* Asymmetric grid. On mobile everything stacks single-column; on lg
          we use a 3-col grid where individual cards opt-into spanning. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6 auto-rows-auto">
        {services.map((s, i) => {
          const cardType = pickCardType(i);
          const photoIndex = (i + 1) % Math.max(photos.length, 1);
          const photo = photos[photoIndex] ?? photos[0] ?? null;
          return (
            <ServiceCard
              key={s.slug}
              service={s}
              photo={photo}
              cardType={cardType}
              index={i}
            />
          );
        })}
      </div>
    </section>
  );
}

type CardType = "feature" | "photo-stack" | "text-led" | "compact";

function pickCardType(i: number): CardType {
  const cycle: CardType[] = ["feature", "photo-stack", "text-led", "compact"];
  return cycle[i % cycle.length];
}

function ServiceCard({
  service: s,
  photo,
  cardType,
  index,
}: {
  service: Service;
  photo: string | null;
  cardType: CardType;
  index: number;
}) {
  const anim = {
    initial: { opacity: 0, y: 24 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-80px" },
    transition: { duration: 0.5, delay: 0.05 * index },
  } as const;

  switch (cardType) {
    case "feature":
      return (
        <motion.a
          href={`/services/${s.slug}`}
          {...anim}
          className="group relative overflow-hidden rounded-3xl bg-ink min-h-[480px] lg:min-h-[520px] lg:col-span-2 flex flex-col justify-end p-7 md:p-10 hover:-translate-y-1 transition-all"
        >
          {photo && (
            <img
              src={photo}
              alt=""
              width={1600}
              height={1100}
              loading="eager"
              decoding="sync"
              fetchPriority="high"
              className="absolute inset-0 w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-700"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink/95 via-ink/55 to-ink/10" />
          <div className="relative max-w-lg">
            <h3 className="text-3xl md:text-5xl font-semibold tracking-tighter-2 text-white leading-tight">
              {s.name}
            </h3>
            <p className="mt-4 text-white/85 leading-relaxed text-base md:text-lg line-clamp-4">
              {s.short_description}
            </p>
            <div className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
              Learn more
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </div>
          </div>
        </motion.a>
      );

    case "photo-stack":
      return (
        <motion.a
          href={`/services/${s.slug}`}
          {...anim}
          className="group flex flex-col overflow-hidden rounded-3xl bg-surface ring-1 ring-ink/5 hover:-translate-y-1 transition-all min-h-[480px] lg:min-h-[520px]"
        >
          {photo && (
            <div className="relative aspect-[5/4] overflow-hidden">
              <img
                src={photo}
                alt=""
                width={900}
                height={720}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
            </div>
          )}
          <div className="p-6 md:p-7 flex flex-col flex-1">
            <h3 className="text-2xl md:text-3xl font-semibold tracking-tight text-ink leading-tight">
              {s.name}
            </h3>
            <p className="mt-3 text-ink-muted leading-relaxed line-clamp-4">
              {s.short_description}
            </p>
            <div className="mt-auto pt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              Learn more
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </div>
          </div>
        </motion.a>
      );

    case "text-led": {
      // Pull-quote card. No photo — leans on typography + brand-accent
      // rule. Uses bullets / detail_paragraph when present for richer
      // content; falls back to short_description.
      const longBody = s.detail_paragraph?.trim() || s.short_description;
      return (
        <motion.a
          href={`/services/${s.slug}`}
          {...anim}
          className="group relative overflow-hidden rounded-3xl bg-surface-alt ring-1 ring-ink/5 p-7 md:p-9 flex flex-col justify-between min-h-[480px] lg:min-h-[520px] hover:-translate-y-1 transition-all"
        >
          <div>
            <Quote
              size={36}
              className="mb-5 opacity-30"
              style={{ color: "rgb(var(--c-primary))" }}
            />
            <h3
              className="text-2xl md:text-3xl font-semibold tracking-tight text-ink leading-tight"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {s.name}
            </h3>
            <p className="mt-4 text-ink-muted leading-relaxed text-base md:text-lg line-clamp-6">
              {longBody}
            </p>
          </div>
          <div className="mt-6 flex items-center justify-between gap-3">
            <div
              className="h-px flex-1"
              style={{ background: "rgb(var(--c-primary) / 0.3)" }}
            />
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              Learn more
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </div>
          </div>
        </motion.a>
      );
    }

    case "compact":
      // Wide horizontal card — photo left, text right. Spans the full
      // grid width on lg, so it acts as a closer beat to the section.
      return (
        <motion.a
          href={`/services/${s.slug}`}
          {...anim}
          className="group grid grid-cols-1 sm:grid-cols-[1fr_1.5fr] overflow-hidden rounded-3xl bg-surface ring-1 ring-ink/5 lg:col-span-3 hover:-translate-y-1 transition-all min-h-[280px]"
        >
          {photo && (
            <div className="relative overflow-hidden">
              <img
                src={photo}
                alt=""
                width={900}
                height={900}
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
              />
            </div>
          )}
          <div className="p-6 md:p-8 flex flex-col justify-center">
            <h3 className="text-2xl md:text-3xl font-semibold tracking-tight text-ink leading-tight">
              {s.name}
            </h3>
            <p className="mt-3 text-ink-muted leading-relaxed line-clamp-3 max-w-2xl">
              {s.short_description}
            </p>
            <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
              Learn more
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </div>
          </div>
        </motion.a>
      );
  }
}
