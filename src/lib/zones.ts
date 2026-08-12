import { supabase } from "@/integrations/supabase/client";
import type { StaffLite } from "@/components/MonthGrid";
import type { RosterShift } from "@/lib/roster";
import { assignmentNumber } from "@/lib/sheet-schedule-import";

/** Editable mapping of assignment number → unit → zone, configured in Settings. */
export type ZoneAssignment = {
  id: string;
  area: string;
  assignment_no: string;
  unit: string;
  zone: string;
  sort_order: number;
};

export const UNASSIGNED_ZONE = "Unassigned";

export async function fetchZoneAssignments(area: string): Promise<ZoneAssignment[]> {
  const { data } = await supabase
    .from("zone_assignments")
    .select("*")
    .eq("area", area)
    .order("sort_order");
  return (data as ZoneAssignment[]) ?? [];
}

export type ScheduleGroup = { label: string; unitHint?: string; staff: StaffLite[] };

/**
 * Group the roster under zone headers, keeping the Excel row order inside each zone.
 * A person's zone is their most frequent assignment number in the visible month;
 * ties break toward the earlier zone. No assignments at all → "Unassigned".
 */
export function buildScheduleGroups(input: {
  staff: StaffLite[];
  shifts: RosterShift[];
  zones: ZoneAssignment[];
}): ScheduleGroup[] {
  const { staff, shifts, zones } = input;
  const zoneByNo = new Map(zones.map((z) => [z.assignment_no, z]));
  const zoneRank = new Map<string, number>();
  for (const z of zones) {
    const cur = zoneRank.get(z.zone);
    if (cur == null || z.sort_order < cur) zoneRank.set(z.zone, z.sort_order);
  }

  const counts = new Map<string, Map<string, number>>();
  const order = new Map<string, number>();
  for (const s of shifts) {
    const email = s.staff_email.toLowerCase();
    const so = s.sort_order ?? 0;
    if (so > 0) {
      const cur = order.get(email);
      if (cur == null || so < cur) order.set(email, so);
    }
    const num = assignmentNumber(s.unit_code);
    if (!num) continue;
    const m = counts.get(email) ?? new Map<string, number>();
    m.set(num, (m.get(num) ?? 0) + 1);
    counts.set(email, m);
  }

  const zoneOf = (email: string): string => {
    const m = counts.get(email);
    if (!m || m.size === 0) return UNASSIGNED_ZONE;
    let best: { num: string; count: number; rank: number } | null = null;
    for (const [num, count] of m) {
      const z = zoneByNo.get(num);
      const rank = z ? (zoneRank.get(z.zone) ?? 9999) : 9999;
      if (
        !best ||
        count > best.count ||
        (count === best.count && rank < best.rank)
      )
        best = { num, count, rank };
    }
    const z = best ? zoneByNo.get(best.num) : undefined;
    return z?.zone ?? UNASSIGNED_ZONE;
  };

  const groups = new Map<string, StaffLite[]>();
  const indexed = staff.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => {
    const oa = order.get(a.s.email.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const ob = order.get(b.s.email.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.i - b.i;
  });
  for (const { s } of indexed) {
    const zone = zoneOf(s.email.toLowerCase());
    if (!groups.has(zone)) groups.set(zone, []);
    groups.get(zone)!.push(s);
  }

  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => {
      if (a === UNASSIGNED_ZONE) return 1;
      if (b === UNASSIGNED_ZONE) return -1;
      return (zoneRank.get(a) ?? 9999) - (zoneRank.get(b) ?? 9999) || a.localeCompare(b);
    })
    .map(([label, list]) => ({ label, staff: list }));
}
