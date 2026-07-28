import { isWeekendDay } from "@/lib/roster";

/** Roles that work office hours (9h/day, Sunday–Thursday). */
export const OFFICE_HOUR_ROLES = ["admin", "supervisor", "team_leader"] as const;
export const OFFICE_SHIFT_HOURS = 9;
export const BEDSIDE_SHIFT_HOURS = 12;
/** Max bedside overtime a supervisor / acting supervisor may take per calendar month. */
export const BEDSIDE_MONTHLY_LIMIT_HOURS = 24;

export function isOfficeHoursRole(role: string | null | undefined): boolean {
  return !!role && (OFFICE_HOUR_ROLES as readonly string[]).includes(role);
}

/** Admins are never assigned bedside shifts. Supervisors / acting supervisors may, as overtime. */
export function canTakeBedsideShift(role: string | null | undefined): boolean {
  return role === "supervisor" || role === "team_leader";
}

/** Office-hours work week: Sunday(0) – Thursday(4). Friday/Saturday are days off. */
export function isOfficeWorkingDay(d: Date): boolean {
  const wd = d.getDay();
  return wd >= 0 && wd <= 4;
}

function parseISO(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

/**
 * Vacation day count for a date range.
 * Office-hour roles only burn Sunday–Thursday; everyone else counts every calendar day.
 */
export function countVacationDays(startISO: string, endISO: string, role: string | null | undefined): number {
  const office = isOfficeHoursRole(role);
  const cur = parseISO(startISO);
  const end = parseISO(endISO);
  let n = 0;
  while (cur <= end) {
    if (!office || isOfficeWorkingDay(cur)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export type BedsideCheck = { ok: true } | { ok: false; message: string };

/**
 * Validate a bedside (12h overtime) assignment for a supervisor / acting supervisor.
 * Rules: never admins, weekend-only (Fri/Sat day schedules, Thu/Fri night), always overtime,
 * capped at 24h (2 shifts) per calendar month.
 */
export function validateBedsideAssignment(input: {
  role: string | null | undefined;
  dateISO: string;
  duty: "Day" | "Night";
  otType: string;
  /** Bedside overtime hours already booked for this person in the same calendar month, excluding the edited shift. */
  existingMonthHours: number;
  hours: number;
}): BedsideCheck {
  const { role, dateISO, duty, otType, existingMonthHours, hours } = input;
  if (!isOfficeHoursRole(role)) return { ok: true }; // bedside staff: unchanged rules
  if (!canTakeBedsideShift(role)) {
    return { ok: false, message: "Admins can never be assigned bedside shifts." };
  }
  if (otType === "None") {
    return { ok: false, message: "Supervisor bedside coverage must be logged as overtime, not a regular duty shift." };
  }
  if (!isWeekendDay(parseISO(dateISO), duty === "Night" ? "night" : "day")) {
    return {
      ok: false,
      message: duty === "Night"
        ? "Night bedside overtime must fall on a weekend (Thursday or Friday)."
        : "Day bedside overtime must fall on a weekend (Friday or Saturday).",
    };
  }
  if (hours !== BEDSIDE_SHIFT_HOURS) {
    return { ok: false, message: `Bedside shifts are ${BEDSIDE_SHIFT_HOURS} hours.` };
  }
  if (existingMonthHours + hours > BEDSIDE_MONTHLY_LIMIT_HOURS) {
    return { ok: false, message: "Monthly bedside overtime limit (24h) reached for this supervisor" };
  }
  return { ok: true };
}

/** Sum of bedside overtime hours already logged in a month for one person. */
export function bedsideHoursInMonth(
  shifts: { staff_email: string; date: string; hours: number; ot_type: string; duty: string; id?: string }[],
  email: string,
  year: number,
  month: number,
  excludeShiftId?: string,
): number {
  return shifts
    .filter((s) =>
      s.staff_email.toLowerCase() === email.toLowerCase() &&
      s.id !== excludeShiftId &&
      s.ot_type !== "None" &&
      (s.duty === "Day" || s.duty === "Night") &&
      new Date(s.date + "T00:00:00").getFullYear() === year &&
      new Date(s.date + "T00:00:00").getMonth() === month)
    .reduce((n, s) => n + Number(s.hours || 0), 0);
}