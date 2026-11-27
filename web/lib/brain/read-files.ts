/**
 * brain/read-files.ts — read the files attached to a Brain message on the server (27 Nov 2026).
 *
 * Inputs:  the uploaded files (name, type, bytes), already checked by checkFiles (lib/brain/attachments.ts)
 * Outputs: { list: { name, rows, skipped } | null, briefs: [{ name, text | null, note? }], usd } or { refused }
 * Used by: app/api/brain/jobs/route.ts
 *
 * A list: CSV (parseCsv) or Excel .xlsx (exceljs, first sheet) → rowsFromTable. A brief: .txt / .md as text, .docx
 * (mammoth), PDF / images read once by OpenAI (lib/services/openai-brain.ts readBriefFile, ~1¢). A brief that can't be
 * read is noted ("couldn't read it") and the job goes on without it. Files are never stored.
 */
import "@/lib/server-guard";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { getLogger } from "@/lib/logger";
import { readBriefFile } from "@/lib/services/openai-brain";
import { clipBrief, fileKind, parseCsv, rowsFromTable, type ImportRow } from "./attachments";

const log = getLogger("brain-read-files");

export interface Upload {
  name: string;
  type: string;
  data: Buffer;
}

export type ReadResult =
  | { list: { name: string; rows: ImportRow[]; skipped: { reason: string; count: number }[] } | null; briefs: { name: string; text: string | null; note?: string }[]; usd: number }
  | { refused: string };

const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

async function xlsxTable(data: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) cells.push(String(row.getCell(c).text ?? ""));
    out.push(cells);
  });
  return out;
}

export async function readUploads(files: Upload[], deps: { readBrief?: typeof readBriefFile } = {}): Promise<ReadResult> {
  const readBrief = deps.readBrief ?? readBriefFile;
  let list: { name: string; rows: ImportRow[]; skipped: { reason: string; count: number }[] } | null = null;
  const briefs: { name: string; text: string | null; note?: string }[] = [];
  let usd = 0;
  for (const f of files) {
    const e = ext(f.name);
    if (fileKind(f.name) === "list") {
      const table = e === "xlsx" ? await xlsxTable(f.data).catch(() => null) : parseCsv(f.data.toString("utf8"));
      if (!table) return { refused: `${f.name}: I couldn't open this Excel file. Save it again as .xlsx or .csv.` };
      const r = rowsFromTable(table);
      if (!r.ok) return { refused: `${f.name}: ${r.message}` };
      list = { name: f.name, rows: r.rows, skipped: r.skipped };
      continue;
    }
    try {
      let text: string;
      if (e === "txt" || e === "md") text = f.data.toString("utf8");
      else if (e === "docx") text = (await mammoth.extractRawText({ buffer: f.data })).value;
      else {
        const mime = e === "pdf" ? "application/pdf" : IMAGE_MIME[e];
        const r = await readBrief({ name: f.name, mime, data: f.data });
        text = r.text;
        usd += r.usd;
      }
      const clipped = clipBrief(text);
      briefs.push(clipped ? { name: f.name, text: clipped } : { name: f.name, text: null, note: "it was empty" });
    } catch (err) {
      log.warn({ name: f.name, err: String(err).slice(0, 200) }, "brain.read_brief_failed");
      briefs.push({ name: f.name, text: null, note: "couldn't read it" });
    }
  }
  return { list, briefs, usd: Math.round(usd * 1e6) / 1e6 };
}
