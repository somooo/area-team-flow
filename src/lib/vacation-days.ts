import { supabase } from "@/integrations/supabase/client";

/**
 * The schedule never stores vacation: it reads it from the vacation module.
 * These helpers turn approved vacation ranges into a lookup the grid can paint.
 */

export const vacationKey = (email: string, iso: string) => `${email.toLowerCase()}|${iso}`;

/** Inclusive calendar walk with no timezone conversion. */
export function eachVacationDay(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  let [y, m, d] = [sy, sm, sd];
  const iso = () =>
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  let guard = 0;
  while (iso() <= end && guard++ < 1000) {
    out.push(iso());
    d++;
    if (d > new Date(y, m, 0).getDate()) { d = 1; m++; }
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export type VacationDays = {
  /** `email|YYYY-MM-DD` for every approved vacation day in the window. */
  keys: Set<string>;
  /** Same keys mapped to the leave request that produced them. */
  byKey: Map<string, { id: string; staff_email: string; staff_name: string; start_date: string; end_date: string }>;
};

/**
 * Approved vacations overlapping [startISO, endISO], across every area: a vacation is a
 * whole-day absence and shows on every schedule the person appears on.
 */
export async function fetchVacationDays(startISO: string, endISO: string): Promise<VacationDays> {
  const { data } = await supabase
    .from("leave_requests")
    .select("id,staff_email,staff_name,start_date,end_date")
    .eq("leave_type", "Vacation")
    .eq("status", "Approved")
    .lte("start_date", endISO)
    .gte("end_date", startISO);

  const keys = new Set<string>();
  const byKey: VacationDays["byKey"] = new Map();
  for (const r of (data ?? []) as { id: string; staff_email: string; staff_name: string; start_date: string; end_date: string }[]) {
    for (const iso of eachVacationDay(r.start_date, r.end_date)) {
      if (iso < startISO || iso > endISO) continue;
      const k = vacationKey(r.staff_email, iso);
      keys.add(k);
      byKey.set(k, r);
    }
  }
  return { keys, byKey };
}
