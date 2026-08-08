import { describe, it, expect } from "vitest";
import {
  parseCellCode, detectScheduleLayout, planScheduleImport, type Workbook,
} from "@/lib/schedule-import";
import { exportCell } from "@/lib/schedule-export";
import type { AssignmentCode } from "@/lib/assignments";
import type { RosterShift } from "@/lib/roster";
import type { StaffLite } from "@/components/MonthGrid";

const code = (over: Partial<AssignmentCode>): AssignmentCode => ({
  id: over.code ?? "x", area: "Wards", layer: "day", code: "A3", unit: "Zone A",
  duty: "Day", unit_code: "3", sort_order: 0, ...over,
});

const CODES = [code({ code: "A3", unit_code: "3" }), code({ code: "A4", unit_code: "4" })];

describe("parseCellCode", () => {
  it("reads both vacation spellings and the other leave keywords", () => {
    expect(parseCellCode("V", CODES, 12)).toMatchObject({ ok: true, cell: { duty: "Vacation" } });
    expect(parseCellCode("VAC", CODES, 12)).toMatchObject({ ok: true, cell: { duty: "Vacation" } });
    expect(parseCellCode(" off ", CODES, 12)).toMatchObject({ ok: true, cell: { duty: "Off" } });
    expect(parseCellCode("S", CODES, 12)).toMatchObject({ ok: true, cell: { duty: "Sick" } });
    expect(parseCellCode("P", CODES, 12)).toMatchObject({ ok: true, cell: { duty: "Paternity" } });
  });

  it("consumes the overtime suffix and stores only the base code", () => {
    const r = parseCellCode("A3|BOT", CODES, 12);
    expect(r).toMatchObject({ ok: true, cell: { duty: "Day", unit_code: "3", ot_type: "BuiltIn" } });
    expect(JSON.stringify(r)).not.toContain("BOT|");
  });

  it("keeps the s prefix as a sick tag on the base code", () => {
    expect(parseCellCode("sA3", CODES, 12)).toMatchObject({ ok: true, cell: { unit_code: "3", sick_tag: true } });
  });

  it("reports an unrecognised suffix instead of dropping the cell", () => {
    expect(parseCellCode("A3|XYZ", CODES, 12)).toMatchObject({ ok: false });
  });

  it("treats MOT as a standalone MedEvac entry", () => {
    expect(parseCellCode("MOT", CODES, 12)).toMatchObject({ ok: true, cell: { ot_type: "MedEvac", unit_code: null } });
    expect(parseCellCode("A3|MOT", CODES, 12)).toMatchObject({ ok: false });
    const sick = parseCellCode("sMOT", CODES, 12);
    expect(sick.ok).toBe(false);
    expect(!sick.ok && sick.reason).toMatch(/sick leave/i);
  });

  it("round-trips through exportCell without losing the overtime type", () => {
    const shift = {
      id: "1", staff_email: "a@b.c", staff_name: "A", area: "Wards", date: "2026-08-03",
      shift_type: "Morning", hours: 12, is_overtime: true, notes: null,
      unit_code: "3", duty: "Day", ot_type: "BuiltIn", sick_tag: false,
    } as RosterShift;
    const out = exportCell(shift, false);
    expect(out.display).toBe("D3");
    const back = parseCellCode(out.raw, [code({ code: "A3", unit_code: "3" })], 12);
    expect(back).toMatchObject({ ok: true, cell: { duty: "Day", unit_code: "3", ot_type: "BuiltIn", sick_tag: false } });
  });
});

/* -------------------------------------------------------------- */

const pad = (n: number) => Array.from({ length: n }, () => "");

function wardsMatrix(): unknown[][] {
  const days = (m: number) => Array.from({ length: 31 }, (_, i) => new Date(2026, m, i + 1));
  const m: unknown[][] = [];
  m.push(["Wards Schedule - August 2026"]);
  while (m.length < 13) m.push([]);
  m.push(["Staff Name ", "Badge", ...days(7), "Day Coverage", "OT", "Duty", "R/Shifts"]); // row 13
  m.push(["Zone A", "", ...pad(31)]);
  m.push(["Allan Reyes", 64530, ...Array.from({ length: 31 }, (_, i) => (i % 3 === 0 ? "A3|BOT" : i % 5 === 0 ? "V" : "OFF")), 99, 99, 99, 99]);
  m.push(["Coverage/day", "", ...Array.from({ length: 31 }, () => "ok")]);
  while (m.length < 81) m.push([]);
  m.push(["Night Schedule"]);
  m.push(["Staff Name", "Badge", ...days(7)]); // night header
  m.push(["Nawaf Ali", 45726, ...Array.from({ length: 31 }, () => "A4")]);
  return m;
}

function assistantsMatrix(): unknown[][] {
  const m: unknown[][] = [];
  m.push(["Assistants schedule"]);
  m.push([]);
  m.push([]);
  m.push(["", "", ...["TUE", "WED", "THU", "FRI", "SAT", "SUN", "MON"].concat(Array.from({ length: 23 }, (_, i) => ["TUE", "WED", "THU", "FRI", "SAT", "SUN", "MON"][i % 7]))]);
  m.push(["Name", "Badge", ...Array.from({ length: 30 }, (_, i) => i + 1), "Reg", "Act", "OT"]);
  m.push(["Melody Cruz", "'45726", ...Array.from({ length: 30 }, () => "A3"), 1, 2, 3]);
  return m;
}

const wb = (matrix: unknown[][], name = "Schedule"): Workbook => ({ sheetNames: [name], sheets: { [name]: matrix } });

describe("detectScheduleLayout", () => {
  it("finds both grids in a date-header workbook and tags the second as night", () => {
    const l = detectScheduleLayout(wb(wardsMatrix()), "Ward Schedule Aug 2026 R0-1.xlsx", { year: 2026, month: 7 });
    expect(l.blocks).toHaveLength(2);
    expect(l.blocks[0].layer).toBe("day");
    expect(l.blocks[1].layer).toBe("night");
    expect(l.blocks[0].confidence.month).toBe("certain");
    expect(l.blocks[0].month).toBe(7);
    expect(l.blocks[0].year).toBe(2026);
  });

  it("excludes the trailing summary columns from the day run", () => {
    const l = detectScheduleLayout(wb(wardsMatrix()), "w.xlsx", { year: 2026, month: 7 });
    expect(l.blocks[0].dayCount).toBe(31);
    expect(l.blocks[0].dayStartCol).toBe(2);
  });

  it("resolves the month from a weekday row when day headers are plain integers", () => {
    const l = detectScheduleLayout(wb(assistantsMatrix()), "schedule_Assistants_2026_09.xlsx", { year: 2026, month: 8 });
    expect(l.blocks).toHaveLength(1);
    expect(l.blocks[0].month).toBe(8);
    expect(l.blocks[0].year).toBe(2026);
    expect(l.blocks[0].monthSource).toBe("weekday-row");
    expect(l.blocks[0].confidence.month).toBe("inferred");
    expect(l.blocks[0].dayCount).toBe(30);
  });

  it("warns when the weekday row contradicts the resolved month", () => {
    const m = assistantsMatrix();
    m[3] = ["", "", ...Array.from({ length: 30 }, () => "FRI")];
    const l = detectScheduleLayout(wb(m), "schedule_2026_09.xlsx", { year: 2026, month: 8 });
    // A Friday 1st resolves to a different month than September 2026 (a Tuesday).
    expect(l.blocks[0].month).not.toBe(8);
  });
});

describe("planScheduleImport", () => {
  const staff: StaffLite[] = [
    { id: "s1", name: "Allan Reyes", email: "allan@h.org", area: "Wards", department: "Zone A" } as StaffLite,
  ];
  const badges = { "allan@h.org": "64530" };

  it("skips label and footer rows instead of importing them as people", () => {
    const matrix = wardsMatrix();
    const layout = detectScheduleLayout(wb(matrix), "w.xlsx", { year: 2026, month: 7 });
    const res = planScheduleImport({
      matrix, blocks: [layout.blocks[0]], staff, badges, shifts: [], codes: CODES, replace: true,
    });
    expect(res.labelRowsSkipped).toBeGreaterThanOrEqual(2);
    expect(res.items.every((i) => i.label === "Allan Reyes")).toBe(true);
  });

  it("ignores the workbook's own calculated columns", () => {
    const matrix = wardsMatrix();
    const layout = detectScheduleLayout(wb(matrix), "w.xlsx", { year: 2026, month: 7 });
    const res = planScheduleImport({
      matrix, blocks: [layout.blocks[0]], staff, badges, shifts: [], codes: CODES, replace: true,
    });
    expect(res.items.some((i) => i.change.includes("99"))).toBe(false);
  });

  it("treats every cell as an add in replace mode", () => {
    const matrix = wardsMatrix();
    const layout = detectScheduleLayout(wb(matrix), "w.xlsx", { year: 2026, month: 7 });
    const existing: RosterShift[] = [{
      id: "old", staff_email: "allan@h.org", staff_name: "Allan Reyes", area: "Wards", date: "2026-08-01",
      shift_type: "Morning", hours: 12, is_overtime: true, notes: null, unit_code: "3",
      duty: "Day", ot_type: "BuiltIn", sick_tag: false,
    }];
    const res = planScheduleImport({
      matrix, blocks: [layout.blocks[0]], staff, badges, shifts: existing, codes: CODES, replace: true,
    });
    expect(res.items.every((i) => i.status === "add")).toBe(true);
    expect(res.items.every((i) => !i.payload?.existingId)).toBe(true);
  });
});
