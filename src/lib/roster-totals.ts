import type { RosterShift } from "@/lib/roster";

export type StaffTotals = {
  day: number; night: number; hours: number; ot_hours: number; sick: number; vacation: number;
  paternity: number;
  /** Total duty days after the sick-on-OT rule. */
  duty_shifts: number;
  regular_shifts: number;
  /** duty_shifts − regular_shifts, never negative. */
  ot_shifts: number;
  /** Duty days removed by the sick-on-OT rule, reported so nothing disappears. */
  sick_on_ot: number;
  /** Leave cells counted for the regular-shift formula (V/S/P, not OFF). */
  leave_cells: number;
  /** leave_cells plus benefit days, the figure fed into the formula. */
  leave_days: number;
  /** True when the person's home area differs from the schedule's area. */
  cross_area: boolean;
  /** Set when an admin/supervisor override replaced the computed value. */
  override_applied: boolean;
  /** The formula result, kept alongside an override so the UI can grey it out. */
  computed_regular_shifts: number;
};

export type TotalsOptions = {
  /** Days in the month being counted. Required for the regular-shift formula. */
  daysInMonth?: number;
  /** Sick days on BOT/AOT shifts are not duty days. */
  sickOtExcludedFromDuty?: boolean;
  /** staff.shift_base_override — 14 for SANG staff, null otherwise. */
  baseOverride?: number | null;
  /** Home area of the staff member. */
  staffArea?: string | null;
  /** Area of the schedule being counted. */
  scheduleArea?: string | null;
  /** Manual per-staff/per-month override of regular shifts. */
  regularShiftsOverride?: number | null;
  /** Leave days in a period after which 2 benefit days are added. */
  benefitDaysMinHolidays?: number;
};

/** Half-up rounding, applied consistently (never banker's or half-down). */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/** 16 shifts in 31-day months, 15 otherwise. SANG staff override this with 14. */
export function baseShiftsFor(daysInMonth: number, baseOverride?: number | null): number {
  if (baseOverride != null) return baseOverride;
  return daysInMonth === 31 ? 16 : 15;
}

/**
 * R/Shifts = max(0, round_half_up((days_in_month − leave_days) / days_in_month × base))
 * `leaveDays` is the post-benefit-days figure (see `leaveDaysFor`).
 */
export function regularShifts(input: { daysInMonth: number; leaveDays: number; base?: number | null }): number {
  const { daysInMonth } = input;
  if (!daysInMonth) return 0;
  const base = baseShiftsFor(daysInMonth, input.base);
  const worked = Math.max(0, daysInMonth - Math.max(0, input.leaveDays));
  return Math.max(0, roundHalfUp((worked / daysInMonth) * base));
}

/** Leave cells plus 2 benefit days once the period qualifies. */
export function leaveDaysFor(leaveCells: number, benefitDaysMinHolidays = 5): number {
  return leaveCells + (leaveCells >= benefitDaysMinHolidays ? 2 : 0);
}

const isSick = (s: RosterShift) => s.duty === "Sick" || !!s.sick_tag;
const isWorking = (s: RosterShift) => s.duty === "Day" || s.duty === "Night";

export function totalsForStaff(shifts: RosterShift[], options: TotalsOptions = {}): StaffTotals {
  const daysInMonth = options.daysInMonth ?? 0;
  const excludeSickOt = options.sickOtExcludedFromDuty ?? false;

  const t: StaffTotals = {
    day: 0, night: 0, hours: 0, ot_hours: 0, sick: 0, vacation: 0, paternity: 0,
    duty_shifts: 0, regular_shifts: 0, ot_shifts: 0, sick_on_ot: 0,
    leave_cells: 0, leave_days: 0, cross_area: false,
    override_applied: false, computed_regular_shifts: 0,
  };

  for (const s of shifts) {
    if (s.duty === "Day") t.day++;
    else if (s.duty === "Night") t.night++;
    t.hours += Number(s.hours ?? 0);
    if (s.is_overtime) t.ot_hours += Number(s.hours ?? 0);

    if (isSick(s)) t.sick++;
    if (s.duty === "Vacation") t.vacation++;
    if (s.duty === "Paternity") t.paternity++;
    if (s.duty === "Vacation" || s.duty === "Paternity" || s.duty === "Sick") t.leave_cells++;

    if (!isWorking(s)) continue;
    // MedEvac is exempt: the person came in on their off day, so it is always duty.
    const otExcludable = s.ot_type === "BuiltIn" || s.ot_type === "Additional";
    if (excludeSickOt && isSick(s) && otExcludable) { t.sick_on_ot++; continue; }
    t.duty_shifts++;
  }

  t.leave_days = leaveDaysFor(t.leave_cells, options.benefitDaysMinHolidays ?? 5);

  const home = (options.staffArea ?? "").trim().toLowerCase();
  const sched = (options.scheduleArea ?? "").trim().toLowerCase();
  t.cross_area = !!home && !!sched && home !== sched;

  t.computed_regular_shifts = t.cross_area
    ? 0
    : regularShifts({ daysInMonth, leaveDays: t.leave_days, base: options.baseOverride });

  if (options.regularShiftsOverride != null) {
    t.regular_shifts = options.regularShiftsOverride;
    t.override_applied = true;
  } else {
    t.regular_shifts = t.computed_regular_shifts;
  }

  t.ot_shifts = Math.max(0, t.duty_shifts - t.regular_shifts);
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
