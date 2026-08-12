import type { ImportItem } from "@/components/ExcelImportButton";
import type { StaffLite } from "@/components/MonthGrid";
import { toISODate, type Duty, type OtType, type RosterShift } from "@/lib/roster";
import { normalizeBadge } from "@/lib/staff-import";
import type { DirectoryPerson, MissingPerson } from "@/lib/schedule-import";

/**
 * Importer for the cleaned two-sheet format: one "Day" sheet and one "Night" sheet,
 * row 1 = header (A name, B badge, C.. dates), data rows below.
 *
 * Rules that must never change:
 *  - Day/Night comes ONLY from which sheet a row was read from, never from the code text.
 *  - Codes are stored exactly as written, including the "s" prefix and |BOT / |AOT suffix.
 *  - Staff are matched by badge only.
 */

export type SheetSide = "day" | "night";

export type SheetRow = { row: number; name: string; badge: string; order: number };

export type SheetLayout = {
  sheetName: string;
  side: SheetSide;
  /** Every column in row 1 holding a real date, in sheet order. */
  dateCols: { col: number; iso: string }[];
  month: number;
  year: number;
  rows: SheetRow[];
  blankRowsSkipped: number;
  warnings: string[];
};

export type SheetPayload = {
  duty: Duty;
  unit_code: string | null;
  ot_type: OtType;
  hours: number;
  sick_tag: boolean;
};

export type SheetCell = {
  staff: StaffLite;
  date: string;
  side: SheetSide;
  order: number;
  existingId?: string;
  payload: null | SheetPayload;
};

const asDate = (v: unknown): Date | null => {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
};

const text = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return "";
  return String(v).trim();
};

/** Read the layout of one cleaned sheet. Trailing empty columns are ignored entirely. */
export function detectSheetLayout(
  matrix: unknown[][],
  sheetName: string,
  side: SheetSide,
): SheetLayout {
  const warnings: string[] = [];
  const header = matrix[0] ?? [];
  const dateCols: { col: number; iso: string; d: Date }[] = [];
  for (let c = 2; c < header.length; c++) {
    const d = asDate(header[c]);
    if (d) dateCols.push({ col: c, iso: toISODate(d), d });
  }
  if (dateCols.length === 0) {
    return {
      sheetName,
      side,
      dateCols: [],
      month: new Date().getMonth(),
      year: new Date().getFullYear(),
      rows: [],
      blankRowsSkipped: 0,
      warnings: [`No dated header cells were found in row 1 of "${sheetName}".`],
    };
  }

  const first = dateCols[0].d;
  const month = first.getMonth();
  const year = first.getFullYear();
  const otherMonth = dateCols.filter((c) => c.d.getMonth() !== month);
  if (otherMonth.length) {
    warnings.push(
      `${otherMonth.length} dated header cell${otherMonth.length === 1 ? "" : "s"} on "${sheetName}" fall outside ${new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" })}.`,
    );
  }
  const expectedDays = new Date(year, month + 1, 0).getDate();
  if (!otherMonth.length && dateCols.length !== expectedDays) {
    warnings.push(
      `"${sheetName}" has ${dateCols.length} dated columns but that month has ${expectedDays} days.`,
    );
  }

  // Last row holding a name or a badge; everything blank in between is skipped silently.
  let lastRow = 0;
  for (let r = 1; r < matrix.length; r++) {
    if (text(matrix[r]?.[0]) || text(matrix[r]?.[1])) lastRow = r;
  }
  const rows: SheetRow[] = [];
  let blankRowsSkipped = 0;
  for (let r = 1; r <= lastRow; r++) {
    const name = text(matrix[r]?.[0]);
    const badge = text(matrix[r]?.[1]);
    if (!name && !badge) {
      blankRowsSkipped++;
      continue;
    }
    rows.push({ row: r, name, badge: normalizeBadge(badge), order: rows.length + 1 });
  }

  return {
    sheetName,
    side,
    dateCols: dateCols.map(({ col, iso }) => ({ col, iso })),
    month,
    year,
    rows,
    blankRowsSkipped,
    warnings,
  };
}

const LEAVE: Record<string, Duty> = {
  V: "Vacation",
  VAC: "Vacation",
  OFF: "Off",
  S: "Sick",
  SL: "Sick",
  P: "Paternity",
  PL: "Paternity",
};

export type CellParse =
  | { ok: true; payload: SheetPayload | null }
  | { ok: false; reason: string };

/** Parse one schedule cell. The side decides Day/Night — the code text never does. */
export function parseSheetCell(raw: string, side: SheetSide, hours = 12): CellParse {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, payload: null };

  const parts = value.split("|");
  if (parts.length > 2) return { ok: false, reason: `unrecognised value "${value}"` };
  const base = parts[0].trim();
  const tag = (parts[1] ?? "").trim().toUpperCase();
  const upper = base.toUpperCase();
  const duty: Duty = side === "night" ? "Night" : "Day";

  if (!tag && LEAVE[upper]) {
    return {
      ok: true,
      payload: { duty: LEAVE[upper], unit_code: null, ot_type: "None", hours: 0, sick_tag: false },
    };
  }
  if (upper === "MOT" || tag === "MOT") {
    if (upper !== "MOT" && tag !== "MOT")
      return { ok: false, reason: "MedEvac OT does not carry a ward code" };
    return {
      ok: true,
      payload: { duty, unit_code: null, ot_type: "MedEvac", hours, sick_tag: false },
    };
  }
  if (tag && !["BOT", "AOT"].includes(tag))
    return { ok: false, reason: `unrecognised tag "${tag}"` };

  const ot: OtType = tag === "BOT" ? "BuiltIn" : tag === "AOT" ? "Additional" : "None";
  // Verbatim: the "s" prefix and the exact letters/digits from the file are kept.
  return { ok: true, payload: { duty, unit_code: base, ot_type: ot, hours, sick_tag: false } };
}

/** "sD12|BOT" -> "12". Returns null when the cell carries no assignment number. */
export function assignmentNumber(code: string | null | undefined): string | null {
  if (!code) return null;
  const base = String(code).split("|")[0].trim().replace(/^s/, "");
  const m = base.match(/(\d+)\s*$/);
  if (!m) return null;
  return String(Number(m[1]));
}

const crossSheetWarning = (code: string, side: SheetSide): string | null => {
  const base = code.split("|")[0].trim().replace(/^s/, "").toUpperCase();
  if (side === "day" && /^N\d/.test(base)) return `Night code "${code}" found on the Day sheet`;
  if (side === "night" && /^D\d/.test(base)) return `Day code "${code}" found on the Night sheet`;
  return null;
};

export type SheetSource = { side: SheetSide; layout: SheetLayout; matrix: unknown[][] };

export type SheetPlanInput = {
  sources: SheetSource[];
  /** People already on this area's schedule. */
  staff: StaffLite[];
  directory: DirectoryPerson[];
  shifts: RosterShift[];
  /** Known assignment numbers from the zone map, used to flag unmapped ones. */
  knownAssignmentNumbers?: Set<string>;
  replace?: boolean;
  defaultHours?: number;
};

export type SheetPlanResult = {
  items: ImportItem<SheetCell>[];
  missing: MissingPerson[];
  addedToSchedule: StaffLite[];
  crossSheetWarnings: string[];
  unmappedNumbers: string[];
  bothSheets: string[];
  perSheet: { side: SheetSide; sheetName: string; rows: number; matched: number; dateCols: number; blankRowsSkipped: number }[];
  warnings: string[];
};

export function planSheetImport(input: SheetPlanInput): SheetPlanResult {
  const defaultHours = input.defaultHours ?? 12;
  const items: ImportItem<SheetCell>[] = [];
  const byBadge = new Map<string, DirectoryPerson>();
  for (const p of input.directory) {
    const key = normalizeBadge(p.badge);
    if (key) byBadge.set(key, p);
  }
  const onSchedule = new Set(input.staff.map((s) => s.email.toLowerCase()));
  const missing = new Map<string, MissingPerson>();
  const added = new Map<string, StaffLite>();
  const current = new Map<string, RosterShift>();
  for (const s of input.shifts) current.set(`${s.staff_email.toLowerCase()}|${s.date}`, s);

  const crossSheetWarnings: string[] = [];
  const unmapped = new Set<string>();
  const warnings: string[] = [];
  const perSheet: SheetPlanResult["perSheet"] = [];
  const seenByBadgeSide = new Map<string, Set<SheetSide>>();

  for (const src of input.sources) {
    const { layout, matrix, side } = src;
    warnings.push(...layout.warnings);
    let matched = 0;

    for (const row of layout.rows) {
      const member = row.badge ? byBadge.get(row.badge) : undefined;
      if (!member) {
        const entry = missing.get(row.badge || `row-${row.row}`) ?? {
          badge: row.badge,
          name: row.name || "(no name in file)",
          rows: 0,
        };
        entry.rows++;
        missing.set(row.badge || `row-${row.row}`, entry);
        items.push({
          id: `${side}-${row.row}-missing`,
          label: row.name || `Badge ${row.badge}`,
          badge: row.badge,
          change: "—",
          status: "skip",
          reason: "Badge not found in staff directory",
        });
        continue;
      }
      matched++;
      const seen = seenByBadgeSide.get(row.badge) ?? new Set<SheetSide>();
      seen.add(side);
      seenByBadgeSide.set(row.badge, seen);
      if (!onSchedule.has(member.email.toLowerCase())) added.set(member.email.toLowerCase(), member);

      for (const dc of layout.dateCols) {
        const raw = text(matrix[row.row]?.[dc.col]);
        const existing = current.get(`${member.email.toLowerCase()}|${dc.iso}`);
        if (!raw) continue;

        const cross = crossSheetWarning(raw, side);
        if (cross) crossSheetWarnings.push(`${member.name} · ${dc.iso} — ${cross}`);

        const parsed = parseSheetCell(raw, side, existing?.hours ?? defaultHours);
        const id = `${side}-${row.row}-${dc.col}`;
        const change = `${dc.iso}: ${raw}`;
        if (!parsed.ok) {
          items.push({
            id,
            label: member.name,
            badge: row.badge,
            change,
            status: "skip",
            reason: parsed.reason,
          });
          continue;
        }
        const num = assignmentNumber(parsed.payload?.unit_code ?? null);
        if (num && input.knownAssignmentNumbers && !input.knownAssignmentNumbers.has(num))
          unmapped.add(num);

        items.push({
          id,
          label: member.name,
          badge: row.badge,
          area: side === "night" ? "Night" : "Day",
          change,
          warning: cross ?? undefined,
          status: input.replace || !existing ? "add" : "update",
          payload: {
            staff: member,
            date: dc.iso,
            side,
            order: row.order,
            existingId: input.replace ? undefined : existing?.id,
            payload: parsed.payload,
          },
        });
      }
    }

    perSheet.push({
      side,
      sheetName: layout.sheetName,
      rows: layout.rows.length,
      matched,
      dateCols: layout.dateCols.length,
      blankRowsSkipped: layout.blankRowsSkipped,
    });
  }

  const bothSheets = Array.from(seenByBadgeSide.entries())
    .filter(([, sides]) => sides.size > 1)
    .map(([badge]) => badge);

  return {
    items,
    missing: Array.from(missing.values()).sort((a, b) => b.rows - a.rows),
    addedToSchedule: Array.from(added.values()),
    crossSheetWarnings,
    unmappedNumbers: Array.from(unmapped).sort((a, b) => Number(a) - Number(b)),
    bothSheets,
    perSheet,
    warnings,
  };
}
