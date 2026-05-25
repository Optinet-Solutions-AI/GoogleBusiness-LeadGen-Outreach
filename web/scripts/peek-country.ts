import { getDb } from "../lib/db";

(async () => {
  const db = getDb();
  const { data: lead } = await db.from("leads").select("id, batch_id, business_name, address").eq("id", "e9fc7566-a0e5-48da-bd1e-a0aee99efc61").single();
  console.log("Lead:", JSON.stringify(lead, null, 2));
  if (lead) {
    const { data: batch } = await db.from("batches").select("*").eq("id", lead.batch_id).single();
    console.log("\nBatch keys:", Object.keys(batch ?? {}));
    console.log("Batch:", JSON.stringify(batch, null, 2));
  }
})();
