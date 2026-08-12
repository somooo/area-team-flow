import type { ImportItem } from "@/components/ExcelImportButton";
import { exportCell } from "@/lib/schedule-export";
import {
  isWeekendDay,
  monthDays,
  toISODate,
  type Duty,
  type OtType,
  type RosterShift,
} from "@/lib/roster";
import { codesForLayer, type AssignmentCode } from "@/lib/assignments";
import type { StaffLite } from "@/components/MonthGrid";
import { normalizeBadge } from "@/lib/staff-import";

/** A directory record used for badge matching during a schedule import. */
export type DirectoryPerson = StaffLite & { badge: string; position?: string | null };

/** A badge present in the file that has no Staff Directory record. */
export type MissingPerson = { badge: string; name: string; rows: number };

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ColumnConfidence = "certain" | "inferred" | "guess";
export type Layer = "day" | "night";
export type MonthSource =
  | "date-headers"
  | "weekday-row"
  | "title-text"
  | "filename"
  | "ui-selection";

export type DetectedBlock = {
  id: string;
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  nameCol: number;
  badgeCol: number | null;
  dayStartCol: number;
  dayCount: number;
  /** 0-11 */
  month: number;
  year: number;
  layer: Layer;
  monthSource: MonthSource;
  confidence: Record<"header" | "name" | "badge" | "days" | "month" | "layer", ColumnConfidence>;
  warnings: string[];
};

export type DetectedLayout = {
  sheetName: string;
  sheetNames: string[];
  blocks: DetectedBlock[];
  warnings: string[];
  /** A second grid was suspected but did not meet the run threshold. */
  possibleMissedBlockRows: number[];
};

export type Workbook = { sheetNames: string[]; sheets: Record<string, unknown[][]> };

export type ImportedCell = {
  staff: StaffLite;
  date: string;
  existingId?: string;
  /** null = clear the cell */
  payload: null | {
    duty: Duty;
    unit_code: string | null;
    ot_type: OtType;
    hours: number;
    sick_tag: boolean;
  };
};

/** Where an unknown code should be sent. */
export type CodeMapTarget = string; // an assignment code, or "VAC" | "OFF" | "SICK" | "PAT" | "SKIP"
export type CodeMap = Record<string, CodeMapTarget>;

/* ------------------------------------------------------------------ */
/* Cell helpers                                                        */
/* ------------------------------------------------------------------ */

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return "";
  return String(v).trim();
};

const asDate = (v: unknown): Date | null => {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  return null;
};

const asInt = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  const s = cellText(v);
  if (/^\d{1,2}$/.test(s)) return Number(s);
  return null;
};

const sameDay = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

/** Column index → Excel letter (0 → A). */
export function colLetter(i: number): string {
  let n = i + 1,
    out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Day-run detection                                                   */
/* ------------------------------------------------------------------ */

const MIN_RUN = 20;

type DayRun = { start: number; count: number; kind: "date" | "number"; first?: Date };

function dateRunAt(row: unknown[], c: number): DayRun | null {
  const first = asDate(row[c]);
  if (!first) return null;
  let count = 1,
    prev = first;
  for (let i = c + 1; i < row.length && count < 31; i++) {
    const d = asDate(row[i]);
    if (!d || sameDay(prev, d) !== 1 || d.getMonth() !== first.getMonth()) break;
    prev = d;
    count++;
  }
  return { start: c, count, kind: "date", first };
}

function numberRunAt(row: unknown[], c: number): DayRun | null {
  if (asInt(row[c]) !== 1) return null;
  let count = 1;
  for (let i = c + 1; i < row.length && count < 31; i++) {
    if (asInt(row[i]) !== count + 1) break;
    count++;
  }
  return { start: c, count, kind: "number" };
}

/** Longest qualifying day run in a row, searched only from column index 2 onward. */
export function findDayRun(row: unknown[]): DayRun | null {
  let best: DayRun | null = null;
  for (let c = 1; c < row.length; c++) {
    const r = dateRunAt(row, c) ?? numberRunAt(row, c);
    if (r && (!best || r.count > best.count)) best = r;
    if (best && best.count >= 28) break;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Name / badge column detection                                       */
/* ------------------------------------------------------------------ */

const looksBadge = (s: string) =>
  /^\d{4,8}$/.test(s.replace(/\D/g, "")) && s.replace(/\D/g, "").length >= 4;
const looksName = (s: string) => /[A-Za-z]{3,}/.test(s) && !looksBadge(s);

function pickNameBadge(
  matrix: unknown[][],
  headerRow: number,
  firstDataRow: number,
  lastDataRow: number,
  dayStart: number,
) {
  const header = matrix[headerRow] ?? [];
  let nameCol = -1,
    badgeCol: number | null = null;
  let nameConf: ColumnConfidence = "guess",
    badgeConf: ColumnConfidence = "guess";

  for (let c = 0; c < dayStart; c++) {
    const label = cellText(header[c]);
    if (nameCol < 0 && /name/i.test(label)) {
      nameCol = c;
      nameConf = "certain";
    }
    if (badgeCol == null && /badge|id\s*no|employee/i.test(label)) {
      badgeCol = c;
      badgeConf = "certain";
    }
  }

  if (nameCol < 0 || badgeCol == null) {
    const scores: { c: number; name: number; badge: number }[] = [];
    for (let c = 0; c < dayStart; c++) {
      let name = 0,
        badge = 0;
      for (let r = firstDataRow; r <= lastDataRow; r++) {
        const v = cellText(matrix[r]?.[c]);
        if (!v) continue;
        if (looksBadge(v)) badge++;
        else if (looksName(v)) name++;
      }
      scores.push({ c, name, badge });
    }
    if (nameCol < 0) {
      const best = scores.slice().sort((a, b) => b.name - a.name)[0];
      if (best && best.name > 0) {
        nameCol = best.c;
        nameConf = "inferred";
      }
    }
    if (badgeCol == null) {
      const best = scores.filter((s) => s.c !== nameCol).sort((a, b) => b.badge - a.badge)[0];
      if (best && best.badge > 0) {
        badgeCol = best.c;
        badgeConf = "inferred";
      }
    }
  }
  if (nameCol < 0) nameCol = 0;
  return { nameCol, badgeCol, nameConf, badgeConf };
}

/* ------------------------------------------------------------------ */
/* Month / year resolution                                             */
/* ------------------------------------------------------------------ */

function weekdayRowAbove(
  matrix: unknown[][],
  headerRow: number,
  dayStart: number,
): string[] | null {
  for (const r of [headerRow - 1, headerRow + 1]) {
    const row = matrix[r];
    if (!row) continue;
    const vals = [0, 1, 2].map((i) => cellText(row[dayStart + i]).toLowerCase());
    const ok = vals.filter((v) => v && WEEKDAYS.some((w) => w.startsWith(v.slice(0, 3)))).length;
    if (ok >= 2) return row.slice(dayStart).map((v) => cellText(v).toLowerCase());
  }
  return null;
}

function weekdayIndexOf(token: string): number {
  const t = token.slice(0, 3);
  return WEEKDAYS.findIndex((w) => w.startsWith(t));
}

function monthFromWeekday(
  firstWeekday: number,
  uiYear: number,
  uiMonth: number,
): { year: number; month: number } | null {
  for (let delta = 0; delta <= 6; delta++) {
    for (const sign of delta === 0 ? [0] : [-1, 1]) {
      const d = new Date(uiYear, uiMonth + sign * delta, 1);
      if (d.getDay() === firstWeekday) return { year: d.getFullYear(), month: d.getMonth() };
    }
  }
  return null;
}

function monthFromTitle(
  matrix: unknown[][],
  headerRow: number,
): { year: number; month: number } | null {
  for (let r = Math.max(0, headerRow - 14); r < headerRow; r++) {
    for (const cell of matrix[r] ?? []) {
      const m = cellText(cell).match(
        /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
      );
      if (m) return { month: MONTH_NAMES.indexOf(m[1].toLowerCase()), year: Number(m[2]) };
    }
  }
  return null;
}

function monthFromFilename(filename: string): { year: number; month: number } | null {
  const m = filename.match(/(\d{4})[-_](\d{2})/);
  if (m) {
    const mo = Number(m[2]) - 1;
    if (mo >= 0 && mo <= 11) return { year: Number(m[1]), month: mo };
  }
  const t = filename.match(
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})/i,
  );
  if (t) return { month: MONTH_NAMES.indexOf(t[1].toLowerCase()), year: Number(t[2]) };
  return null;
}

/* ------------------------------------------------------------------ */
/* Layer detection                                                     */
/* ------------------------------------------------------------------ */

function detectLayer(
  matrix: unknown[][],
  headerRow: number,
  order: number,
): { layer: Layer; confidence: ColumnConfidence } {
  for (let r = Math.max(0, headerRow - 12); r <= headerRow + 4; r++) {
    for (const cell of matrix[r] ?? []) {
      const s = cellText(cell);
      if (/night/i.test(s)) return { layer: "night", confidence: "inferred" };
      if (/\bday\b/i.test(s) && !/day coverage|days/i.test(s))
        return { layer: "day", confidence: "inferred" };
    }
  }
  return { layer: order === 0 ? "day" : "night", confidence: "guess" };
}

/* ------------------------------------------------------------------ */
/* Layout detection                                                    */
/* ------------------------------------------------------------------ */

export function scoreSheet(matrix: unknown[][]): number {
  let score = 0;
  for (const row of matrix) {
    const run = findDayRun(row ?? []);
    if (run && run.count >= MIN_RUN) score += run.count;
  }
  return score;
}

export function detectScheduleLayout(
  workbook: Workbook,
  filename: string,
  ui: { year: number; month: number },
  preferredSheet?: string,
): DetectedLayout {
  const sheetName =
    preferredSheet && workbook.sheets[preferredSheet]
      ? preferredSheet
      : workbook.sheetNames
          .slice()
          .sort(
            (a, b) => scoreSheet(workbook.sheets[b] ?? []) - scoreSheet(workbook.sheets[a] ?? []),
          )[0];
  const matrix = workbook.sheets[sheetName] ?? [];
  const warnings: string[] = [];
  const possibleMissedBlockRows: number[] = [];

  const headerRows: { row: number; run: DayRun }[] = [];
  matrix.forEach((row, i) => {
    const run = findDayRun(row ?? []);
    if (!run) return;
    if (run.count >= MIN_RUN) headerRows.push({ row: i, run });
    else if (run.count >= 8) possibleMissedBlockRows.push(i);
  });

  const blocks: DetectedBlock[] = headerRows.map(({ row: headerRow, run }, idx) => {
    const nextHeader = headerRows[idx + 1]?.row ?? matrix.length;
    const dayStart = run.start;

    const weekdays = weekdayRowAbove(matrix, headerRow, dayStart);
    const weekdayIsBelow =
      !!weekdays &&
      !!matrix[headerRow + 1] &&
      weekdayIndexOf(cellText(matrix[headerRow + 1][dayStart]).toLowerCase()) >= 0;
    const firstDataRow = headerRow + (weekdayIsBelow ? 2 : 1);

    // Block ends at the next header, or the first row with no name, no badge and no day cells.
    let lastDataRow = firstDataRow - 1;
    for (let r = firstDataRow; r < nextHeader; r++) {
      const rowVals = matrix[r] ?? [];
      const hasAnything =
        cellText(rowVals[0]) !== "" ||
        rowVals.slice(0, dayStart).some((v) => cellText(v) !== "") ||
        rowVals.slice(dayStart, dayStart + run.count).some((v) => cellText(v) !== "");
      if (!hasAnything) break;
      lastDataRow = r;
    }
    if (lastDataRow < firstDataRow) lastDataRow = firstDataRow;

    const { nameCol, badgeCol, nameConf, badgeConf } = pickNameBadge(
      matrix,
      headerRow,
      firstDataRow,
      lastDataRow,
      dayStart,
    );

    // Month / year, in priority order.
    let month = ui.month,
      year = ui.year;
    let monthSource: MonthSource = "ui-selection";
    let monthConf: ColumnConfidence = "guess";
    const blockWarnings: string[] = [];

    if (run.kind === "date" && run.first) {
      month = run.first.getMonth();
      year = run.first.getFullYear();
      monthSource = "date-headers";
      monthConf = "certain";
    } else if (weekdays && weekdayIndexOf(weekdays[0] ?? "") >= 0) {
      const resolved = monthFromWeekday(weekdayIndexOf(weekdays[0]), ui.year, ui.month);
      if (resolved) {
        month = resolved.month;
        year = resolved.year;
        monthSource = "weekday-row";
        monthConf = "inferred";
      }
    }
    if (monthSource === "ui-selection") {
      const t = monthFromTitle(matrix, headerRow);
      if (t) {
        month = t.month;
        year = t.year;
        monthSource = "title-text";
        monthConf = "inferred";
      } else {
        const f = monthFromFilename(filename);
        if (f) {
          month = f.month;
          year = f.year;
          monthSource = "filename";
          monthConf = "guess";
        }
      }
    }

    // Always cross-check the weekday row, whatever the source.
    if (weekdays) {
      const wd = weekdayIndexOf(weekdays[0] ?? "");
      const actual = new Date(year, month, 1).getDay();
      if (wd >= 0 && wd !== actual) {
        blockWarnings.push(
          `Weekday row says the 1st is a ${WEEKDAYS[wd].replace(/^./, (c) => c.toUpperCase())}, but ${new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" })} starts on a ${WEEKDAYS[actual].replace(/^./, (c) => c.toUpperCase())}.`,
        );
      }
    }

    const { layer, confidence: layerConf } = detectLayer(matrix, headerRow, idx);

    return {
      id: `block-${idx}`,
      headerRow,
      firstDataRow,
      lastDataRow,
      nameCol,
      badgeCol,
      dayStartCol: dayStart,
      dayCount: Math.min(run.count, 31),
      month,
      year,
      layer,
      monthSource,
      confidence: {
        header: "certain",
        name: nameConf,
        badge: badgeCol == null ? "guess" : badgeConf,
        days: run.kind === "date" ? "certain" : "inferred",
        month: monthConf,
        layer: layerConf,
      },
      warnings: blockWarnings,
    };
  });

  for (const b of blocks) warnings.push(...b.warnings);
  if (blocks.length === 1 && possibleMissedBlockRows.length) {
    warnings.push(
      `This sheet may contain a second grid around row ${possibleMissedBlockRows[0] + 1} that did not look complete enough to import. Check it before continuing.`,
    );
  }
  if (blocks.length === 0) warnings.push("No schedule grid was found in this sheet.");

  return { sheetName, sheetNames: workbook.sheetNames, blocks, warnings, possibleMissedBlockRows };
}

/* ------------------------------------------------------------------ */
/* Cell parsing                                                        */
/* ------------------------------------------------------------------ */

type ParseResult = { ok: true; cell: ImportedCell["payload"] } | { ok: false; reason: string };

const LEAVE: Record<string, Duty> = {
  V: "Vacation",
  VAC: "Vacation",
  OFF: "Off",
  S: "Sick",
  SL: "Sick",
  P: "Paternity",
  PL: "Paternity",
};

const leaveCell = (duty: Duty): ImportedCell["payload"] => ({
  duty,
  unit_code: null,
  ot_type: "None",
  hours: 0,
  sick_tag: false,
});

/**
 * Lookup keys for an assignment code. Matching is case-insensitive, but no
 * letter is ever prefixed: D1/D2/D3/D8 are zone D codes, not "day" markers.
 */
function codeKeys(c: AssignmentCode): string[] {
  return [c.code, c.unit_code]
    .map((k) => (k ?? "").trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Reverse of `exportCell`. Text only — cell fill colours are never read.
 * The `|BOT` / `|AOT` / `|MOT` suffix sets ot_type and is then discarded.
 * A leading lowercase "s" means a night shift and is recorded on `duty`, never in the code.
 * The base code is stored EXACTLY as written in the cell — no prefix, no case change.
 */
export function parseCellCode(
  raw: string,
  codes: AssignmentCode[],
  fallbackHours: number,
  codeMap: CodeMap = {},
): ParseResult {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, cell: null };

  const parts = value.split("|");
  if (parts.length > 2) return { ok: false, reason: `unrecognised value "${value}"` };
  let base = parts[0].trim();
  const tag = (parts[1] ?? "").trim().toUpperCase();

  // Leading lowercase "s" = night shift marker (sA2, sD1, sE2). "SL" is sick leave.
  let night = false;
  if (/^s[A-Za-z]/.test(base) && base.toUpperCase() !== "SL") {
    night = true;
    base = base.slice(1);
  }
  const upper = base.toUpperCase();

  // MedEvac is a standalone entry: no ward code, never sick.
  if (upper === "MOT" || tag === "MOT") {
    if (upper !== "MOT") return { ok: false, reason: "MedEvac OT does not carry a ward code" };
    if (tag && tag !== "MOT") return { ok: false, reason: `unrecognised tag "${tag}"` };
    const duty: Duty = night ? "Night" : ((codes[0]?.duty as Duty) ?? "Day");
    return {
      ok: true,
      cell: { duty, unit_code: null, ot_type: "MedEvac", hours: fallbackHours, sick_tag: false },
    };
  }

  if (tag && !["BOT", "AOT"].includes(tag))
    return { ok: false, reason: `unrecognised tag "${tag}"` };
  const otType: OtType = tag === "BOT" ? "BuiltIn" : tag === "AOT" ? "Additional" : "None";

  if (!night && !tag && LEAVE[upper]) return { ok: true, cell: leaveCell(LEAVE[upper]) };

  const mapped = codeMap[upper];
  if (mapped) {
    if (mapped === "SKIP") return { ok: true, cell: null };
    if (mapped === "VAC") return { ok: true, cell: leaveCell("Vacation") };
    if (mapped === "OFF") return { ok: true, cell: leaveCell("Off") };
    if (mapped === "SICK") return { ok: true, cell: leaveCell("Sick") };
    if (mapped === "PAT") return { ok: true, cell: leaveCell("Paternity") };
  }
  // A code map entry may rewrite the source code onto a known one; otherwise the
  // cell text itself is the code and is stored verbatim.
  const remapped =
    mapped && !["SKIP", "VAC", "OFF", "SICK", "PAT"].includes(mapped) ? mapped : null;
  const stored = remapped ?? base;

  const known = codes.find((c) => codeKeys(c).includes(stored.toUpperCase()));
  if (!known) return { ok: false, reason: `unrecognised code "${value}"` };

  return {
    ok: true,
    cell: {
      duty: night ? "Night" : (known.duty as Duty),
      unit_code: stored || null,
      ot_type: otType,
      hours: fallbackHours,
      sick_tag: false,
    },
  };
}

/** Every distinct cell value in the confirmed blocks that nothing yet knows how to read. */
export type UnknownCode = { code: string; count: number; samples: string[] };

export function collectUnknownCodes(input: {
  matrix: unknown[][];
  blocks: DetectedBlock[];
  codes: AssignmentCode[];
  codeMap?: CodeMap;
  staffByRow?: (block: DetectedBlock, row: number) => string | null;
}): UnknownCode[] {
  const { matrix, blocks, codes } = input;
  const map = new Map<string, UnknownCode>();
  for (const b of blocks) {
    const layerCodes = codesForLayer(codes, b.layer);
    const days = monthDays(b.year, b.month);
    for (let r = b.firstDataRow; r <= b.lastDataRow; r++) {
      const who = input.staffByRow?.(b, r) ?? cellText(matrix[r]?.[b.nameCol]);
      if (!who) continue;
      for (let i = 0; i < Math.min(b.dayCount, days.length); i++) {
        const raw = cellText(matrix[r]?.[b.dayStartCol + i]);
        if (!raw) continue;
        const res = parseCellCode(raw, layerCodes, 12, input.codeMap ?? {});
        if (res.ok) continue;
        const key = raw.toUpperCase();
        const entry = map.get(key) ?? { code: raw, count: 0, samples: [] };
        entry.count++;
        if (entry.samples.length < 3) entry.samples.push(`${who} · ${toISODate(days[i])}`);
        map.set(key, entry);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Diff planning                                                       */
/* ------------------------------------------------------------------ */

export type PlanInput = {
  matrix: unknown[][];
  blocks: DetectedBlock[];
  /** People already on this area's schedule. */
  staff: StaffLite[];
  /** badge_id per staff email, for badge matching. */
  badges?: Record<string, string>;
  /** The whole staff directory, used to add missing people to the schedule. */
  directory?: DirectoryPerson[];
  shifts: RosterShift[];
  codes: AssignmentCode[];
  codeMap?: CodeMap;
  /** Replace mode treats every cell as an add. */
  replace?: boolean;
  defaultHours?: number;
};

export type PlanResult = {
  items: ImportItem<ImportedCell>[];
  labelRowsSkipped: number;
  cellCount: number;
  /** Badges in the file with no directory record at all. */
  missing: MissingPerson[];
  /** People found in the directory who are not yet on this schedule. */
  addedToSchedule: StaffLite[];
};

export function planScheduleImport(input: PlanInput): PlanResult {
  const { matrix, blocks, staff, shifts, codes } = input;
  const defaultHours = input.defaultHours ?? 12;
  const items: ImportItem<ImportedCell>[] = [];
  let labelRowsSkipped = 0;

  // Directory = the match source. When the caller does not pass one, fall back to
  // the people already on the schedule plus their badges.
  const directory: DirectoryPerson[] =
    input.directory ??
    staff.map((s) => ({ ...s, badge: input.badges?.[s.email.toLowerCase()] ?? "" }));

  const byName = new Map(directory.map((s) => [s.name.trim().toLowerCase(), s as StaffLite]));
  const byBadge = new Map<string, StaffLite>();
  for (const p of directory) {
    const key = normalizeBadge(p.badge);
    if (key) byBadge.set(key, p as StaffLite);
  }
  const onSchedule = new Set(staff.map((s) => s.email.toLowerCase()));
  const missing = new Map<string, MissingPerson>();
  const added = new Map<string, StaffLite>();
  const current = new Map<string, RosterShift>();
  for (const s of shifts) current.set(`${s.staff_email.toLowerCase()}|${s.date}`, s);

  for (const b of blocks) {
    const layerCodes = codesForLayer(codes, b.layer);
    const days = monthDays(b.year, b.month);

    for (let r = b.firstDataRow; r <= b.lastDataRow; r++) {
      const row = matrix[r] ?? [];
      const name = cellText(row[b.nameCol]);
      const rawBadge = b.badgeCol == null ? "" : cellText(row[b.badgeCol]);
      const badge = normalizeBadge(rawBadge);
      const member =
        (badge ? byBadge.get(badge) : undefined) ?? byName.get(name.trim().toLowerCase());

      if (!member) {
        if (badge.length >= 4) {
          // A real person the directory has never heard of — never silently dropped.
          const entry = missing.get(badge) ?? { badge, name: name || "(no name in file)", rows: 0 };
          entry.rows++;
          missing.set(badge, entry);
          items.push({
            id: `${b.id}-${r}-missing`,
            label: name || `Badge ${badge}`,
            badge,
            change: "—",
            status: "skip",
            reason: "Not in directory — needs a directory record",
          });
        } else {
          // Zone labels and footer rows: no badge and no matching name.
          labelRowsSkipped++;
        }
        continue;
      }

      if (!onSchedule.has(member.email.toLowerCase())) added.set(member.email.toLowerCase(), member);

      for (let i = 0; i < Math.min(b.dayCount, days.length); i++) {
        const date = toISODate(days[i]);
        const raw = cellText(row[b.dayStartCol + i]);
        const existing = current.get(`${member.email.toLowerCase()}|${date}`);
        const before = input.replace
          ? ""
          : exportCell(existing, isWeekendDay(new Date(`${date}T00:00:00`), b.layer)).raw;
        if (!input.replace && raw === before) continue;
        if (input.replace && !raw) continue;

        const parsed = parseCellCode(
          raw,
          layerCodes,
          existing?.hours ?? defaultHours,
          input.codeMap ?? {},
        );
        const id = `${b.id}-${r}-${i}`;
        const change = `${date}: ${before || "—"} → ${raw || "—"}`;
        if (!parsed.ok) {
          items.push({ id, label: member.name, badge, change, status: "skip", reason: parsed.reason });
          continue;
        }
        items.push({
          id,
          label: member.name,
          badge,
          change,
          status: input.replace || !existing ? "add" : "update",
          payload: {
            staff: member,
            date,
            existingId: input.replace ? undefined : existing?.id,
            payload: parsed.cell,
          },
        });
      }
    }
  }

  return {
    items,
    labelRowsSkipped,
    cellCount: items.filter((i) => i.status !== "skip").length,
    missing: Array.from(missing.values()).sort((a, b) => b.rows - a.rows),
    addedToSchedule: Array.from(added.values()),
  };
}
