/**
 * scripts/test-mode.ts — the operator's switch for Test mode (run by Claude on the operator's word; the app has none).
 *
 * Inputs:  flags: --get | --on | --off | --add-email=x | --remove-email=x | --add-phone=x | --remove-phone=x |
 *          --add-host=x | --remove-host=x ; app_settings 'test_mode' (migration 075); repo-root .env
 * Outputs: the updated setting (addresses masked in the printout: they are private)
 * Used by: the operator, through Claude ("add QA's email to the test list", "switch to live")
 *
 * Usage (from web/): npx tsx --tsconfig tsconfig.json scripts/test-mode.ts --get
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), "..", ".env") });

const mask = (v: string) => (v.includes("@") ? `${v[0]}***@${v.split("@")[1]}` : v.replace(/\d(?=\d{3})/g, "•"));

async function main() {
  const { getTestMode, setTestMode } = await import("@/lib/test-mode");
  const args = process.argv.slice(2);
  const mode = { ...(await getTestMode()) };
  let changed = false;
  for (const a of args) {
    const [flag, raw = ""] = a.split(/=(.*)/s);
    const v = raw.trim();
    const list = flag.endsWith("email") ? "emails" : flag.endsWith("phone") ? "phones" : flag.endsWith("host") ? "hosts" : null;
    if (flag === "--on") mode.on = true;
    else if (flag === "--off") mode.on = false;
    else if (list && v && flag.startsWith("--add-")) mode[list] = [...new Set([...mode[list], list === "emails" || list === "hosts" ? v.toLowerCase() : v])];
    else if (list && v && flag.startsWith("--remove-")) mode[list] = mode[list].filter((x) => x !== v && x !== v.toLowerCase());
    else if (flag !== "--get") throw new Error(`unknown flag ${a}`);
    if (flag !== "--get") changed = true;
  }
  if (changed) await setTestMode(mode);
  const now = await getTestMode();
  console.log(JSON.stringify({ on: now.on, emails: now.emails.map(mask), phones: now.phones.map(mask), hosts: now.hosts }, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
