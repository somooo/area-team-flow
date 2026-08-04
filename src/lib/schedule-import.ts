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

  const headerIdx = matrix.findIndex((r) => String(r?.[0] ?? "").trim().toLowerCase() === "staff name");
  if (headerIdx < 0) {
    return [{ id: "header", label: "File", change: "—", status: "skip", reason: 'no "Staff Name" header row found' }];
  }
  const header = matrix[headerIdx].map((c) => String(c ?? "").trim());
  // day columns: header cells that are plain day numbers
  const dayCols = new Map<number, string>();
  header.forEach((h, ci) => {
    const n = Number(h);
    if (Number.isInteger(n) && n >= 1 && n <= days.length) dayCols.set(ci, toISODate(days[n - 1]));
  });
  if (dayCols.size === 0) {
    return [{ id: "days", label: "File", change: "—", status: "skip", reason: "no day columns found for the selected month" }];
  }

  const byName = new Map(staff.map((s) => [s.name.trim().toLowerCase(), s]));
  const current = new Map<string, RosterShift>();
  for (const s of shifts) current.set(`${s.staff_email.toLowerCase()}|${s.date}`, s);

  for (let ri = headerIdx + 1; ri < matrix.length; ri++) {
    const row = matrix[ri] ?? [];
    const name = String(row[0] ?? "").trim();
    if (!name || name.toLowerCase() === "legend") continue;
    const member = byName.get(name.toLowerCase());
    if (!member) {
      // zone header rows have no day values — ignore them silently
      const hasValues = Array.from(dayCols.keys()).some((ci) => String(row[ci] ?? "").trim() !== "");
      if (!hasValues) continue;
      items.push({ id: `r${ri}`, label: name, change: "—", status: "skip", reason: "name not in this area" });
      continue;
    }

    for (const [ci, date] of dayCols) {
      const raw = String(row[ci] ?? "").trim();
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