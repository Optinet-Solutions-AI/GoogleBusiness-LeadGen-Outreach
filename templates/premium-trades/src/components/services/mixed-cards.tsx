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
 * Card-type rotation by index AND total count so the grid never lands
 * with empty columns:
 *
 *   3 services:  0 → feature (2-col)
 *                1 → photo-stack (1-col)
 *                2 → compact (3-col, full width — fills the bottom row)
 *
 *   4 services:  0 → feature (2-col)
 *                1 → photo-stack (1-col)
 *                2 → text-led (1-col, sits next to feature continued)
 *                3 → compact (3-col, full width)
 *
 *   5+ services: cycles back to feature after compact.
 *
 *   2 services:  0 → feature, 1 → photo-stack. Feature still 2-col but
 *                we override its span at the call site (single row on lg).
 *
 *   1 service:   0 → feature, full width on lg.
 */
import { motion } from "framer-motion";
import { ArrowUpRight, MapPin, Quote } from "lucide-react";
import type { SiteData } from "../../lib/data";
import { resolveServicesHeadline } from "../../lib/format";

type Service = SiteData["copy"]["services"][number];

export default function MixedCardsServices({ data }: { data: SiteData }) {
  const services = data.copy.services;
  const photos = data.photos;
  if (!services.length) return null;

  const eyebrow = data.copy.services_eyebrow ?? "What we do";
  const headline = resolveServicesHeadline(data.copy.services_headline_template, data.address);

  return (
    <section className="container-tight py-24" id="services">
      <div className="flex items-end justify-between gap-6 flex-wrap mb-12">
        <div className="max-w-2xl">
          <span className="eyebrow inline-flex items-center gap-1.5">
            <MapPin size={11} aria-hidden /> {eyebrow}
          </span>
          <h2 className="mt-2 text-4xl md:text-6xl font-semibold tracking-tighter-2 text-ink">
            {headline}
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
          const cardType = pickCardType(i, services.length);
          const photoIndex = (i + 1) % Math.max(photos.length, 1);
          const photo = photos[photoIndex] ?? photos[0] ?? null;
          return (
            <ServiceCard
              key={s.slug}
              service={s}
              photo={photo}
              cardType={cardType}
              index={i}
              total={services.length}
              isOnlyOne={services.length === 1}
            />
          );
        })}
      </div>
    </section>
  );
}

type CardType = "feature" | "photo-stack" | "text-led" | "compact";

function pickCardType(i: number, total: number): CardType {
  // Special case: 3 services. The default cycle would land card #2 on
  // "text-led" (1-col) leaving a half-empty bottom row. Promote it to
  // "compact" (3-col, full width) so the grid closes cleanly.
  if (total === 3) {
    if (i === 0) return "feature";
    if (i === 1) return "photo-stack";
    return "compact";
  }
  // 2 services: feature next to photo-stack, both in one row.
  if (total === 2) {
    return i === 0 ? "feature" : "photo-stack";
  }
  // 1 service: just feature, full bleed.
  if (total === 1) return "feature";
  // 4 services: feature(2) + photo-stack(1) on row 1, then text-led
  // (promoted to 2-col via the per-card override below) + photo-stack(1)
  // on row 2. Avoids the orphan that the original cycle produced when
  // text-led(1) sat alone leaving 2 empty columns.
  if (total === 4) {
    if (i === 0) return "feature";
    if (i === 1) return "photo-stack";
    if (i === 2) return "text-led";   // ServiceCard spans 2 cols when total=4
    return "photo-stack";
  }
  // 5+: original cycle, repeats after the 4-card pattern fills.
  const cycle: CardType[] = ["feature", "photo-stack", "text-led", "compact"];
  return cycle[i % cycle.length];
}

function ServiceCard({
  service: s,
  photo,
  cardType,
  index,
  total,
  isOnlyOne,
}: {
  service: Service;
  photo: string | null;
  cardType: CardType;
  index: number;
  total: number;
  isOnlyOne: boolean;
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
          className={[
            "group relative overflow-hidden rounded-3xl bg-ink min-h-[480px] lg:min-h-[520px] flex flex-col justify-end p-7 md:p-10 hover:-translate-y-1 transition-all",
            isOnlyOne ? "lg:col-span-3" : "lg:col-span-2",
          ].join(" ")}
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
      // For 4-service layouts text-led sits in row 2 at i=2, partnered
      // with a 1-col photo-stack at i=3. Span 2 cols so the row fills
      // cleanly (otherwise text-led(1) + photo-stack(1) leaves a gap
      // in the 3-col grid).
      const spanTwo = total === 4 && index === 2;
      return (
        <motion.a
          href={`/services/${s.slug}`}
          {...anim}
          className={[
            "group relative overflow-hidden rounded-3xl bg-surface-alt ring-1 ring-ink/5 p-7 md:p-9 flex flex-col justify-between min-h-[480px] lg:min-h-[520px] hover:-translate-y-1 transition-all",
            spanTwo ? "lg:col-span-2" : "",
          ].join(" ")}
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
