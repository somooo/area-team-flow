/**
 * Staff Directory import helpers.
 *
 * The directory sheet is read from the raw workbook (cell types preserved) so a
 * date cell stays a real Date and is never turned into an ambiguous d/m/y string.
 */

/** A staff row is a protected development record when its name starts with "Test". */
export function isProtectedTest(r: { name?: string | null; first_name?: string | null }): boolean {
  const t = (v?: string | null) => (v ?? "").replace(/^\s+/, "").toLowerCase().startsWith("test");
  return t(r.name) || t(r.first_name);
}

/** Badge match key: digits only, leading zeros dropped. */
export function normalizeBadge(v: unknown): string {
  if (v == null) return "";
  const digits = String(v).trim().replace(/\D/g, "").replace(/^0+/, "");
  return digits;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse a hire-date cell into a plain YYYY-MM-DD date.
 * Returns a warning instead of throwing when the value cannot be understood —
 * an unreadable date must never drop the staff row.
 */
export function parseHireDate(v: unknown): { date: string | null; warning?: string } {
  if (v == null || v === "") return { date: null };
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Excel dates come back as UTC midnight; read the UTC parts, no timezone shift.
    return { date: iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) };
  }
  if (typeof v === "number" && v > 0 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { date: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) };
  }
  const s = String(v).trim();
  if (!s) return { date: null };
  if (/^\d{5}$/.test(s)) return parseHireDate(Number(s));

  const isoM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoM) return { date: iso(+isoM[1], +isoM[2], +isoM[3]) };

  // "16 Oct'19", "16-Oct-2019", "Oct 16, 2019"
  const named = s.match(/^(\d{1,2})[\s.\-/]*([A-Za-z]{3,})[\s.\-/']*(\d{2,4})$/);
  const named2 = s.match(/^([A-Za-z]{3,})[\s.\-/]*(\d{1,2})[\s,.\-/']*(\d{2,4})$/);
  const hit = named
    ? { d: +named[1], mon: named[2], y: named[3] }
    : named2
    ? { d: +named2[2], mon: named2[1], y: named2[3] }
    : null;
  if (hit) {
    const mi = MONTHS.indexOf(hit.mon.slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const yr = hit.y.length <= 2 ? (+hit.y > 50 ? 1900 + +hit.y : 2000 + +hit.y) : +hit.y;
      return { date: iso(yr, mi + 1, hit.d) };
    }
  }

  // Numeric d/m/y text. Day-first is the sheet's convention; if the first part
  // cannot be a day it is treated as a month instead.
  const parts = s.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/);
  if (parts) {
    const a = +parts[1], b = +parts[2], c = +parts[3];
    if (String(parts[1]).length === 4) return { date: iso(a, b, c) };
    const yr = c < 100 ? (c > 50 ? 1900 + c : 2000 + c) : c;
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) return { date: iso(yr, b, a) };
    if (b >= 1 && b <= 31 && a >= 1 && a <= 12) return { date: iso(yr, a, b) };
  }
  return { date: null, warning: `Could not read the hire date "${s}" — imported without it` };
}

/** Case/space-insensitive header matching. */
export const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type SheetRow = { values: Record<string, unknown>; rowNumber: number };

/**
 * Pick the sheet that actually holds the directory (the one with a BADGE header
 * and the most data rows) and return every row of its used range.
 */
export function readStaffRows(workbook: { sheetNames: string[]; sheets: Record<string, unknown[][]> }): {
  rows: SheetRow[];
  headers: string[];
} {
  let best: { rows: SheetRow[]; headers: string[]; score: number } = { rows: [], headers: [], score: -1 };
  for (const name of workbook.sheetNames) {
    const matrix = workbook.sheets[name] ?? [];
    // Header row = first row that mentions a badge column.
    const headerIndex = matrix.findIndex((r) =>
      (r ?? []).some((c) => ["badge", "badgeno", "badgenumber", "badgeid"].includes(normHeader(String(c ?? "")))),
    );
    if (headerIndex < 0) continue;
    const headers = (matrix[headerIndex] ?? []).map((c) => String(c ?? "").trim());
    const rows: SheetRow[] = [];
    for (let i = headerIndex + 1; i < matrix.length; i++) {
      const raw = matrix[i] ?? [];
      const values: Record<string, unknown> = {};
      let any = false;
      headers.forEach((h, ci) => {
        if (!h) return;
        const v = raw[ci];
        values[h] = v;
        if (v !== "" && v != null) any = true;
      });
      if (!any) continue;
      rows.push({ values, rowNumber: i + 1 });
    }
    if (rows.length > best.score) best = { rows, headers, score: rows.length };
  }
  return { rows: best.rows, headers: best.headers };
}

/** Read one field from a sheet row by any of its accepted header names. */
export function cell(values: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = names.map(normHeader);
  for (const [k, v] of Object.entries(values)) {
    if (wanted.includes(normHeader(k))) return v;
  }
  return undefined;
}

/** Same as `cell` but always a trimmed string ("" when absent). */
export function text(values: Record<string, unknown>, ...names: string[]): string {
  const v = cell(values, ...names);
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Excel formula strings leak through when a cached value is missing. */
export function isFormula(v: string): boolean {
  return v.startsWith("=") || /^#(REF|VALUE|N\/A|NAME)/i.test(v);
}
