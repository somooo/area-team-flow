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

import { readDateParts } from "@/lib/xlsx-io";

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
  // One shared reader for every import path: no timezone conversion, no new Date(string).
  const parts = readDateParts(v);
  if (parts) return { date: iso(parts.year, parts.month, parts.day) };
  const s = String(v).trim();
  if (!s) return { date: null };
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
  if (v instanceof Date) return parseHireDate(v).date ?? "";
  return String(v).trim();
}

/** Excel formula strings leak through when a cached value is missing. */
export function isFormula(v: string): boolean {
  return v.startsWith("=") || /^#(REF|VALUE|N\/A|NAME)/i.test(v);
}
