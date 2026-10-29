/**
 * fonts.ts — bundled open-licence fonts (Inter, Source Serif 4; both SIL OFL) as inline @font-face CSS.
 *
 * Inputs:  fonts/Inter-Variable.woff2, fonts/SourceSerif4-Variable.woff2 (read once, cached)
 * Outputs: fontFaceCss() — @font-face rules with data-URI sources; families BrandSans / BrandSerif
 * Used by: templates/index.ts (renderTemplateHtml) so a render needs no network for fonts
 */
import fs from "node:fs";
import path from "node:path";

let cached: string | null = null;

function face(family: string, file: string): string {
  const b64 = fs.readFileSync(path.join(process.cwd(), "lib/creatives/templates/fonts", file)).toString("base64");
  return `@font-face{font-family:"${family}";font-weight:100 900;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
}

export function fontFaceCss(): string {
  if (cached === null) {
    cached = [face("BrandSans", "Inter-Variable.woff2"), face("BrandSerif", "SourceSerif4-Variable.woff2")].join("\n");
  }
  return cached;
}
