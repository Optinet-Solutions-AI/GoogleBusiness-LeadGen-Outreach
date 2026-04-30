/** Tailwind config for the "premium-trades" template.
 *  Custom colors come from CSS variables emitted as R G B triplets so that
 *  Tailwind's opacity modifiers (e.g. bg-brand/20, shadow-ink/5) work.
 *  See Base.astro — it converts the hex palette in data.json to triplets.
 */
const rgb = (varName) => `rgb(var(${varName}) / <alpha-value>)`;
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: rgb("--c-primary"),
        "brand-text": rgb("--c-primary-text"),
        accent: rgb("--c-accent"),
        surface: rgb("--c-surface"),
        "surface-alt": rgb("--c-surface-alt"),
        ink: rgb("--c-neutral-900"),
        "ink-muted": rgb("--c-neutral-500"),
      },
      fontFamily: {
        // Display (Fraunces) for headlines = magazine feel; body (Inter) for
        // legibility at small sizes. Keep system fallbacks so a Google Fonts
        // outage doesn't blank the page.
        heading: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        body: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        "tighter-2": "-0.035em",
      },
      lineHeight: {
        "tight-2": "1.02",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        marquee: "marquee 40s linear infinite",
        "fade-up": "fade-up 600ms ease-out forwards",
      },
    },
  },
  plugins: [],
};
