import type { ImportItem } from "@/components/ExcelImportButton";
import type { StaffLite } from "@/components/MonthGrid";
import { type Duty, type OtType, type RosterShift } from "@/lib/roster";
import { partsToISO, readDateParts, type DateParts } from "@/lib/xlsx-io";
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
  /** Real month number, 1-12 — never a JS month index. */
  month: number;
  year: number;
  /** First and last dated column, as written in the header. */
  firstDate: string | null;
  lastDate: string | null;
  rows: SheetRow[];
  blankRowsSkipped: number;
  warnings: string[];
  /** Columns whose header date falls outside the detected month — these abort the import. */
  outOfMonth: { col: number; header: string; iso: string }[];
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

const headerText = (v: unknown): string => (v == null ? "" : v instanceof Date ? v.toString() : String(v).trim());

/** Number of days in a real (1-12) month, without touching any Date-string parsing. */
export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

export const monthLabelOf = (year: number, month: number) =>
  new Date(year, month - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

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
  const dateCols: { col: number; iso: string; p: DateParts }[] = [];
  for (let c = 2; c < header.length; c++) {
    const p = readDateParts(header[c]);
    if (p) dateCols.push({ col: c, iso: partsToISO(p), p });
  }
  if (dateCols.length === 0) {
    return {
      sheetName,
      side,
      dateCols: [],
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      firstDate: null,
      lastDate: null,
      rows: [],
      blankRowsSkipped: 0,
      warnings: [`No dated header cells were found in row 1 of "${sheetName}".`],
      outOfMonth: [],
    };
  }

  // The month the header claims: the one most of the dated columns belong to.
  const tally = new Map<string, number>();
  for (const c of dateCols) {
    const k = `${c.p.year}-${c.p.month}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const [bestKey] = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0];
  const [year, month] = bestKey.split("-").map(Number);

  const outOfMonth = dateCols
    .filter((c) => c.p.year !== year || c.p.month !== month)
    .map((c) => ({ col: c.col, header: headerText(header[c.col]), iso: c.iso }));
  if (outOfMonth.length) {
    warnings.push(
      `${outOfMonth.length} dated header cell${outOfMonth.length === 1 ? "" : "s"} on "${sheetName}" fall outside ${monthLabelOf(year, month)}.`,
    );
  }
  const expectedDays = daysInMonth(year, month);
  if (!outOfMonth.length && dateCols.length !== expectedDays) {
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
    firstDate: dateCols[0].iso,
    lastDate: dateCols[dateCols.length - 1].iso,
    rows,
    blankRowsSkipped,
    warnings,
    outOfMonth,
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
  perSheet: {
    side: SheetSide; sheetName: string; rows: number; matched: number; dateCols: number;
    blankRowsSkipped: number; monthLabel: string; firstDate: string | null; lastDate: string | null;
  }[];
  warnings: string[];
  /** Inclusive date range every written row must fall inside. */
  range: { start: string; end: string } | null;
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

    // Fail loudly: a header date outside the detected month means the date
    // handling is wrong, and nothing may be written.
    if (layout.outOfMonth.length) {
      const bad = layout.outOfMonth[0];
      throw new Error(
        `Date check failed on sheet "${layout.sheetName}": column ${bad.col + 1} has header “${bad.header}” which reads as ${bad.iso}, outside ${monthLabelOf(layout.year, layout.month)}. Import aborted — no rows were written.`,
      );
    }
    const monthPrefix = `${layout.year}-${String(layout.month).padStart(2, "0")}-`;

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
        if (!dc.iso.startsWith(monthPrefix)) {
          throw new Error(
            `Date check failed on sheet "${layout.sheetName}": column ${dc.col + 1} was about to be written as ${dc.iso}, outside ${monthLabelOf(layout.year, layout.month)}. Import aborted — no rows were written.`,
          );
        }
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
      monthLabel: monthLabelOf(layout.year, layout.month),
      firstDate: layout.firstDate,
      lastDate: layout.lastDate,
    });
  }

  const bothSheets = Array.from(seenByBadgeSide.entries())
    .filter(([, sides]) => sides.size > 1)
    .map(([badge]) => badge);

  const allDates = input.sources.flatMap((s) => s.layout.dateCols.map((d) => d.iso)).sort();
  const range = allDates.length ? { start: allDates[0], end: allDates[allDates.length - 1] } : null;

  return {
    items,
    missing: Array.from(missing.values()).sort((a, b) => b.rows - a.rows),
    addedToSchedule: Array.from(added.values()),
    crossSheetWarnings,
    unmappedNumbers: Array.from(unmapped).sort((a, b) => Number(a) - Number(b)),
    bothSheets,
    perSheet,
    warnings,
    range,
  };
}
