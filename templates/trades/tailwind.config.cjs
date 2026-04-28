/** Tailwind config for the "trades" template.
 *  Brand colors come from CSS variables set per-build from data.json.
 */
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md}"],
  theme: {
    extend: {
      colors: {
        brand: "var(--brand-primary)",
        accent: "var(--brand-accent)",
      },
      fontFamily: {
        heading: ["var(--font-heading)", "Inter", "sans-serif"],
        body: ["var(--font-body)", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
