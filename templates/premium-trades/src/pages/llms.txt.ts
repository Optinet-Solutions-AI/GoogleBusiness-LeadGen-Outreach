/**
 * llms.txt.ts — Per-site /llms.txt generator.
 *
 * Inputs:  data.json (business identity, services, areas, contact)
 * Outputs: text/markdown summary at /llms.txt — high-signal site map for
 *          LLM agents. Per the 2026 llms.txt protocol, this is the file
 *          AI crawlers fetch first to bypass HTML boilerplate.
 * Used by: GPTBot / ClaudeBot / Google-Extended / PerplexityBot.
 *
 * Format: top-level H1 = entity name, blockquote = elevator pitch, then
 *         topic-headed link lists (Services, Areas, Pages).
 */
import type { APIRoute } from "astro";
import data from "../lib/data";

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site?.toString().replace(/\/$/, "") ?? "";

  const services = data.copy.services;
  const areas = data.service_areas ?? [];
  const hours = data.business_hours ?? {};

  const dayLabel: Record<string, string> = {
    mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
    fri: "Fri", sat: "Sat", sun: "Sun",
  };
  const hoursLine = (["mon","tue","wed","thu","fri","sat","sun"] as const)
    .filter((d) => hours[d])
    .map((d) => `${dayLabel[d]}: ${hours[d]}`)
    .join(" · ");

  const lines: string[] = [
    `# ${data.business_name}`,
    "",
    `> ${data.copy.meta_description}`,
    "",
    "## About",
    "",
    data.copy.about_paragraph,
    "",
  ];

  if (services.length) {
    lines.push("## Services", "");
    for (const s of services) {
      lines.push(`- [${s.name}](${baseUrl}/services/${s.slug}): ${s.short_description}`);
    }
    lines.push("");
  }

  if (areas.length) {
    lines.push("## Service area", "");
    lines.push(areas.map((a) => `- ${a}`).join("\n"));
    lines.push("");
  }

  lines.push("## Pages", "");
  lines.push(`- [Home](${baseUrl}/)`);
  lines.push(`- [About](${baseUrl}/about)`);
  if (areas.length) lines.push(`- [Service area](${baseUrl}/service-area)`);
  lines.push(`- [Contact](${baseUrl}/contact)`);
  lines.push("");

  lines.push("## Contact", "");
  if (data.phone) lines.push(`- Phone: ${data.phone}`);
  if (data.email) lines.push(`- Email: ${data.email}`);
  if (data.address && !data.is_service_area_only) lines.push(`- Address: ${data.address}`);
  if (hoursLine) lines.push(`- Hours: ${hoursLine}`);
  lines.push(`- Website: ${baseUrl}`);
  lines.push("");

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
