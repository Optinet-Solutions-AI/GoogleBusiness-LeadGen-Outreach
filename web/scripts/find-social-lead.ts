import { getDb } from "../lib/db";

(async () => {
  const db = getDb();
  const { data } = await db
    .from("leads")
    .select("id, business_name, website_kind, website_url, logo_url, photos")
    .eq("id", "e9fc7566-a0e5-48da-bd1e-a0aee99efc61")
    .single();
  if (!data) { console.log("not found"); return; }
  console.log(JSON.stringify({
    id: data.id,
    business_name: data.business_name,
    website_kind: data.website_kind,
    website_url: data.website_url,
    logo_starts: data.logo_url?.slice(0, 80),
    logo_is_data_uri: data.logo_url?.startsWith("data:"),
  }, null, 2));
})();
