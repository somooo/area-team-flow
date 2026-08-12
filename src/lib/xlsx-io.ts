import * as XLSX from "xlsx";

/** Every sheet of a workbook as raw matrices, keeping Date and number cell types intact. */
export async function readWorkbook(file: File): Promise<{ sheetNames: string[]; sheets: Record<string, unknown[][]> }> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheets: Record<string, unknown[][]> = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: true });
  }
  return { sheetNames: wb.SheetNames, sheets };
}

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

/** Calendar parts of a date. `month` is a real month number, 1-12 — never a JS month index. */
export type DateParts = { year: number; month: number; day: number };

/** Format calendar parts as YYYY-MM-DD. No timezone conversion, ever. */
export const partsToISO = (p: DateParts): string =>
  `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Read the calendar date an Excel cell displays, with no timezone conversion.
 *
 * A Date coming out of SheetJS is midnight in one of the two clocks depending on
 * the parser options, so the clock that reads midnight is the authoritative one.
 * Text is only accepted in unambiguous shapes — `new Date(string)` is never used.
 */
export function readDateParts(v: unknown): DateParts | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const utcMidnight =
      v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
    const localMidnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0;
    if (utcMidnight && !localMidnight)
      return { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate() };
    return { year: v.getFullYear(), month: v.getMonth() + 1, day: v.getDate() };
  }
  if (typeof v === "number" && v > 0 && v < 80000) {
    // Excel serial day number (1900 date system) — pure UTC arithmetic.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{5}$/.test(s)) return readDateParts(Number(s));

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return valid({ year: +iso[1], month: +iso[2], day: +iso[3] });

  // "16 Oct 2019" / "Oct 16, 2019"
  const named = s.match(/^(\d{1,2})[\s.\-/]*([A-Za-z]{3,})[\s.\-/']*(\d{2,4})$/);
  const named2 = s.match(/^([A-Za-z]{3,})[\s.\-/]*(\d{1,2})[\s,.\-/']*(\d{2,4})$/);
  const hit = named
    ? { d: +named[1], mon: named[2], y: named[3] }
    : named2
      ? { d: +named2[2], mon: named2[1], y: named2[3] }
      : null;
  if (hit) {
    const mi = MONTH_NAMES.indexOf(hit.mon.slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const yr = hit.y.length <= 2 ? (+hit.y > 50 ? 1900 + +hit.y : 2000 + +hit.y) : +hit.y;
      return valid({ year: yr, month: mi + 1, day: hit.d });
    }
  }

  // Numeric text. Day-first is the sheets' convention; fall back to month-first
  // only when the first part cannot be a day.
  const parts = s.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/);
  if (parts) {
    const a = +parts[1], b = +parts[2], c = +parts[3];
    if (parts[1].length === 4) return valid({ year: a, month: b, day: c });
    const yr = c < 100 ? (c > 50 ? 1900 + c : 2000 + c) : c;
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) return valid({ year: yr, month: b, day: a });
    if (b >= 1 && b <= 31 && a >= 1 && a <= 12) return valid({ year: yr, month: a, day: b });
  }
  return null;
}

function valid(p: DateParts): DateParts | null {
  if (p.month < 1 || p.month > 12 || p.day < 1 || p.day > 31) return null;
  return p;
}

/** Normalise an Excel cell (Date, serial, ISO text, d/m/y text) to YYYY-MM-DD, or null. */
export function toISODateValue(v: unknown): string | null {
  const p = readDateParts(v);
  return p ? partsToISO(p) : null;
}

/** Write an array-of-arrays as a single-sheet workbook and trigger a download. */
export function downloadSheet(filename: string, sheetName: string, aoa: unknown[][], colWidths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (colWidths) ws["!cols"] = colWidths.map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}