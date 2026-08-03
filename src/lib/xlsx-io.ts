import * as XLSX from "xlsx";

/** Read the first sheet of an .xlsx file both as objects (header row) and as a raw matrix. */
export async function readSheet(file: File): Promise<{
  rows: Record<string, unknown>[];
  matrix: unknown[][];
}> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  return { rows, matrix };
}

/** Case/space-insensitive header lookup on a parsed row. */
export function field(row: Record<string, unknown>, ...names: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = names.map(norm);
  for (const [k, v] of Object.entries(row)) {
    if (wanted.includes(norm(k))) return v == null ? "" : String(v).trim();
  }
  return "";
}

/** Normalise an Excel cell (Date, ISO text, d/m/y text) to YYYY-MM-DD, or null. */
export function toISODateValue(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

/** Write an array-of-arrays as a single-sheet workbook and trigger a download. */
export function downloadSheet(filename: string, sheetName: string, aoa: unknown[][], colWidths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (colWidths) ws["!cols"] = colWidths.map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}