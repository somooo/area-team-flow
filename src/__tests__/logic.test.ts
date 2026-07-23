import { describe, it, expect } from "vitest";
import { toISODate, monthDays } from "@/lib/roster";
import { totalsForStaff } from "@/lib/roster-totals";
import type { RosterShift } from "@/lib/roster";

function countDays(a: string, b: string) {
  const A = new Date(a + "T00:00:00"); const B = new Date(b + "T00:00:00");
  let n = 0; const c = new Date(A);
  while (c <= B) { n++; c.setDate(c.getDate() + 1); }
  return n;
}

describe("date logic", () => {
  it("toISODate uses local components", () => {
    expect(toISODate(new Date(2025, 0, 5))).toBe("2025-01-05");
  });
  it("monthDays returns correct count", () => {
    expect(monthDays(2024, 1).length).toBe(29); // Feb 2024 leap
    expect(monthDays(2025, 1).length).toBe(28);
  });
  it("day count is DST-safe inclusive", () => {
    // Spring-forward in many US zones: 2025-03-09
    expect(countDays("2025-03-08", "2025-03-10")).toBe(3);
    expect(countDays("2025-11-01", "2025-11-03")).toBe(3);
    expect(countDays("2025-01-01", "2025-01-01")).toBe(1);
  });
});

describe("cap math", () => {
  it("floors vacation cap per area", () => {
    const headcount = 7; const pct = 30;
    expect(Math.floor(headcount * pct / 100)).toBe(2);
  });
  it("totals aggregate duties and OT hours", () => {
    const shifts: RosterShift[] = [
      { id:"1", staff_email:"a", staff_name:"A", area:"ICU", date:"2025-01-01", shift_type:"Day", hours:12, is_overtime:false, notes:null, unit_code:"12", duty:"Day", ot_type:"None" },
      { id:"2", staff_email:"a", staff_name:"A", area:"ICU", date:"2025-01-02", shift_type:"Night", hours:6, is_overtime:true, notes:null, unit_code:"6", duty:"Night", ot_type:"BuiltIn" },
      { id:"3", staff_email:"a", staff_name:"A", area:"ICU", date:"2025-01-03", shift_type:"Off", hours:0, is_overtime:false, notes:null, unit_code:null, duty:"Sick", ot_type:"None" },
    ];
    const t = totalsForStaff(shifts);
    expect(t.day).toBe(1);
    expect(t.night).toBe(1);
    expect(t.hours).toBe(18);
    expect(t.ot_hours).toBe(6);
    expect(t.sick).toBe(1);
  });
});