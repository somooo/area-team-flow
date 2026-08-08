import { describe, it, expect } from "vitest";
import { totalsForStaff, regularShifts } from "@/lib/roster-totals";
import type { RosterShift, Duty, OtType } from "@/lib/roster";

const shift = (over: Partial<RosterShift>): RosterShift => ({
  id: Math.random().toString(36), staff_email: "a@b.c", staff_name: "A", area: "Wards",
  date: "2026-08-01", shift_type: "Morning", hours: 12, is_overtime: false, notes: null,
  unit_code: "3", duty: "Day" as Duty, ot_type: "None" as OtType, sick_tag: false, ...over,
});

describe("regular shifts formula", () => {
  it("matches the reference table for regular staff in a 31-day month", () => {
    const table: [number, number][] = [[0, 16], [5, 13], [10, 11], [15, 8], [17, 7], [20, 6], [26, 3], [31, 0]];
    for (const [leaveDays, expected] of table) {
      expect(regularShifts({ daysInMonth: 31, leaveDays })).toBe(expected);
    }
  });

  it("rounds half-up consistently in shorter months", () => {
    expect(regularShifts({ daysInMonth: 30, leaveDays: 0 })).toBe(15);
    expect(regularShifts({ daysInMonth: 30, leaveDays: 1 })).toBe(15); // half-up, deliberately not HR's 14
    expect(regularShifts({ daysInMonth: 30, leaveDays: 15 })).toBe(8);
    expect(regularShifts({ daysInMonth: 30, leaveDays: 30 })).toBe(0);
    expect(regularShifts({ daysInMonth: 28, leaveDays: 14 })).toBe(8);
  });

  it("never returns a negative value", () => {
    expect(regularShifts({ daysInMonth: 31, leaveDays: 60 })).toBe(0);
  });

  it("holds SANG at base 14 in every month length", () => {
    expect(regularShifts({ daysInMonth: 31, leaveDays: 0, base: 14 })).toBe(14);
    expect(regularShifts({ daysInMonth: 31, leaveDays: 10, base: 14 })).toBe(9);
    expect(regularShifts({ daysInMonth: 31, leaveDays: 20, base: 14 })).toBe(5);
    expect(regularShifts({ daysInMonth: 31, leaveDays: 31, base: 14 })).toBe(0);
    expect(regularShifts({ daysInMonth: 28, leaveDays: 0, base: 14 })).toBe(14);
    expect(regularShifts({ daysInMonth: 30, leaveDays: 0, base: 14 })).toBe(14);
  });
});

const fixture: RosterShift[] = [
  shift({ date: "2026-08-01", sick_tag: true, ot_type: "BuiltIn", is_overtime: true }),
  shift({ date: "2026-08-02", sick_tag: true, ot_type: "None" }),
  shift({ date: "2026-08-03" }),
  shift({ date: "2026-08-04" }),
  shift({ date: "2026-08-05", duty: "Vacation", hours: 0 }),
];

describe("sick on overtime rule", () => {
  it("removes sick BOT/AOT days from duty while keeping them in sick leave", () => {
    const t = totalsForStaff(fixture, { daysInMonth: 31, sickOtExcludedFromDuty: true });
    expect(t.duty_shifts).toBe(3);      // 4 working days − 1 sick-on-BOT
    expect(t.sick_on_ot).toBe(1);
    expect(t.sick).toBe(2);             // still reported as sick leave
  });

  it("counts every sick day as duty when the rule is off, raising OT", () => {
    const on = totalsForStaff(fixture, { daysInMonth: 31, sickOtExcludedFromDuty: true });
    const off = totalsForStaff(fixture, { daysInMonth: 31, sickOtExcludedFromDuty: false });
    expect(off.duty_shifts).toBe(4);
    expect(off.sick_on_ot).toBe(0);
    expect(off.ot_shifts).toBeGreaterThanOrEqual(on.ot_shifts);
    expect(off.duty_shifts - on.duty_shifts).toBe(1);
  });

  it("never removes MedEvac from the duty count, with the rule either way", () => {
    const medevac = [shift({ date: "2026-08-06", ot_type: "MedEvac", is_overtime: true })];
    for (const flag of [true, false]) {
      const t = totalsForStaff(medevac, { daysInMonth: 31, sickOtExcludedFromDuty: flag });
      expect(t.duty_shifts).toBe(1);
      expect(t.sick_on_ot).toBe(0);
    }
  });
});

describe("regular shifts in context", () => {
  it("gives cross-area staff zero regular shifts and all-overtime duty", () => {
    const t = totalsForStaff([shift({}), shift({ date: "2026-08-02" })], {
      daysInMonth: 31, staffArea: "ICU", scheduleArea: "Wards",
    });
    expect(t.cross_area).toBe(true);
    expect(t.regular_shifts).toBe(0);
    expect(t.ot_shifts).toBe(t.duty_shifts);
  });

  it("lets a per-staff override win over the computed value and reports both", () => {
    const base = { daysInMonth: 31, sickOtExcludedFromDuty: true };
    const computed = totalsForStaff(fixture, base);
    const overridden = totalsForStaff(fixture, { ...base, regularShiftsOverride: 2 });
    expect(overridden.regular_shifts).toBe(2);
    expect(overridden.override_applied).toBe(true);
    expect(overridden.computed_regular_shifts).toBe(computed.regular_shifts);
    // Clearing the override restores the formula.
    expect(totalsForStaff(fixture, base).regular_shifts).toBe(computed.regular_shifts);
  });

  it("adds benefit days once a leave period qualifies", () => {
    const leave = Array.from({ length: 6 }, (_, i) => shift({ date: `2026-08-1${i}`, duty: "Vacation", hours: 0 }));
    const t = totalsForStaff(leave, { daysInMonth: 31, benefitDaysMinHolidays: 5 });
    expect(t.leave_cells).toBe(6);
    expect(t.leave_days).toBe(8);
  });
});
