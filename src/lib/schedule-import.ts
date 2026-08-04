import type { ImportItem } from "@/components/ExcelImportButton";
import { exportCell } from "@/lib/schedule-export";
import { isWeekendDay, monthDays, toISODate, type Duty, type OtType, type RosterShift } from "@/lib/roster";
import type { AssignmentCode } from "@/lib/assignments";
import type { StaffLite } from "@/components/MonthGrid";

export type ImportedCell = {
  staff: StaffLite;
  date: string;
  existingId?: string;
  /** null = clear the cell */
  payload: null | { duty: Duty; unit_code: string | null; ot_type: OtType; hours: number; sick_tag: boolean };
};

type ParseResult = { ok: true; cell: ImportedCell["payload"] } | { ok: false; reason: string };

/** Reverse of `exportCell`: turn a stored cell string such as `D6|BOT` or `sN12` back into shift fields. */
export function parseCellCode(raw: string, codes: AssignmentCode[], fallbackHours: number): ParseResult {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, cell: null };

  const [basePart, tagPart] = value.split("|");
  let base = basePart.trim();
  let sick = false;
  if (/^s[A-Z]/.test(base)) { sick = true; base = base.slice(1); }
  const upper = base.toUpperCase();
  const tag = (tagPart ?? "").trim().toUpperCase();

  if (upper === "VAC") return { ok: true, cell: { duty: "Vacation", unit_code: null, ot_type: "None", hours: 0, sick_tag: false } };
  if (upper === "OFF") return { ok: true, cell: { duty: "Off", unit_code: null, ot_type: "None", hours: 0, sick_tag: false } };
  if (upper === "P") return { ok: true, cell: { duty: "Paternity", unit_code: null, ot_type: "None", hours: 0, sick_tag: false } };
  if (upper === "S") return { ok: true, cell: { duty: "Sick", unit_code: null, ot_type: "None", hours: 0, sick_tag: false } };

  const known = codes.find((c) => c.code.toUpperCase() === upper);
  if (upper === "MOT") {
    const duty: Duty = (codes[0]?.duty as Duty) ?? "Day";
    return { ok: true, cell: { duty, unit_code: null, ot_type: "MedEvac", hours: fallbackHours, sick_tag: sick } };
  }
  if (!known) return { ok: false, reason: `unrecognised code "${value}"` };

  const otType: OtType = tag === "BOT" ? "BuiltIn" : tag === "AOT" ? "Additional" : tag === "MOT" ? "MedEvac" : "None";
  if (tag && !["BOT", "AOT", "MOT"].includes(tag)) return { ok: false, reason: `unrecognised tag "${tag}"` };

  return {
    ok: true,
    cell: {
      duty: known.duty as Duty,
      unit_code: known.unit_code ?? null,
      ot_type: otType,
      hours: fallbackHours,
      sick_tag: sick,
    },
  };
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return "";
  return String(v).trim();
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  return null;
}

/** Build the diff between an uploaded grid sheet and the schedule currently on screen. */
export function planScheduleImport(input: {
  matrix: unknown[][];
  staff: StaffLite[];
  shifts: RosterShift[];
  codes: AssignmentCode[];
  year: number;
  month: number;
  layer: "all" | "day" | "night";
  defaultHours?: number;
}): ImportItem<ImportedCell>[] {
  const { matrix, staff, shifts, codes, year, month, layer } = input;
  const defaultHours = input.defaultHours ?? 12;
  const days = monthDays(year, month);
  const items: ImportItem<ImportedCell>[] = [];

  // 1) header row: column A = "staff name" AND column B = "badge"
  const headerIdx = matrix.findIndex(
    (r) =>
      cellText(r?.[0]).toLowerCase() === "staff name" &&
      cellText(r?.[1]).toLowerCase().startsWith("badge"),
  );
  if (headerIdx < 0) {
    return [{ id: "header", label: "File", change: "—", status: "skip", reason: 'no header row with "Staff Name" + "Badge" found' }];
  }
  const header = matrix[headerIdx] ?? [];

  // 2) day columns: consecutive real dates starting at column C, in the selected month/year
  const dayCols = new Map<number, string>();
  for (let ci = 2; ci < header.length; ci++) {
    const d = asDate(header[ci]);
    if (!d) break;
    if (d.getFullYear() === year && d.getMonth() === month) dayCols.set(ci, toISODate(d));
  }
  if (dayCols.size === 0) {
    return [{ id: "days", label: "File", change: "—", status: "skip", reason: "no day columns found for the selected month" }];
  }

  const byName = new Map(staff.map((s) => [s.name.trim().toLowerCase(), s]));
  const byBadge = new Map(
    staff
      .filter((s) => (s.badge_id ?? "").trim() !== "")
      .map((s) => [String(s.badge_id).trim().toLowerCase(), s]),
  );
  const current = new Map<string, RosterShift>();
  for (const s of shifts) current.set(`${s.staff_email.toLowerCase()}|${s.date}`, s);

  for (let ri = headerIdx + 1; ri < matrix.length; ri++) {
    const row = matrix[ri] ?? [];
    const name = cellText(row[0]);
    const badge = cellText(row[1]);
    // 4) stop at the first row with no name and no badge
    if (!name && !badge) break;
    // zone / section label rows carry no badge — skip silently
    if (!badge) continue;

    const member = byBadge.get(badge.toLowerCase()) ?? byName.get(name.toLowerCase());
    if (!member) {
      items.push({ id: `r${ri}`, label: name || badge, change: "—", status: "skip", reason: "badge/name not found in directory" });
      continue;
    }

    for (const [ci, date] of dayCols) {
      const raw = cellText(row[ci]);
      const existing = current.get(`${member.email.toLowerCase()}|${date}`);
      const before = exportCell(existing, isWeekendDay(new Date(`${date}T00:00:00`), layer)).raw;
      if (raw === before) continue;

      const parsed = parseCellCode(raw, codes, existing?.hours ?? defaultHours);
      const id = `${ri}-${ci}`;
      const change = `${date}: ${before || "—"} → ${raw || "—"}`;
      if (!parsed.ok) {
        items.push({ id, label: member.name, change, status: "skip", reason: parsed.reason });
        continue;
      }
      items.push({
        id, label: member.name, change,
        status: existing ? "update" : "add",
        payload: { staff: member, date, existingId: existing?.id, payload: parsed.cell },
      });
    }
  }
  return items;
}