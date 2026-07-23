import type { RosterShift } from "@/lib/roster";

export type StaffTotals = {
  day: number; night: number; hours: number; ot_hours: number; sick: number; vacation: number;
};

export function totalsForStaff(shifts: RosterShift[]): StaffTotals {
  const t: StaffTotals = { day: 0, night: 0, hours: 0, ot_hours: 0, sick: 0, vacation: 0 };
  for (const s of shifts) {
    if (s.duty === "Day") t.day++;
    else if (s.duty === "Night") t.night++;
    else if (s.duty === "Sick") t.sick++;
    else if (s.duty === "Vacation") t.vacation++;
    t.hours += Number(s.hours ?? 0);
    if (s.is_overtime) t.ot_hours += Number(s.hours ?? 0);
  }
  return t;
}

export function groupByStaff<T extends { staff_email: string }>(items: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = it.staff_email.toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
}