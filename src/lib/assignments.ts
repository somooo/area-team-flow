import { supabase } from "@/integrations/supabase/client";
import type { Duty, RosterShift } from "@/lib/roster";

export type AssignmentCode = {
  id: string;
  area: string;
  layer: "day" | "night" | "all";
  code: string;
  unit: string | null;
  duty: Duty;
  unit_code: string | null;
  sort_order: number;
};

export type ZoneReferenceRow = {
  id: string;
  area: string;
  zone: string | null;
  unit: string | null;
  assignment_no: string | null;
  label: string | null;
  pager: string | null;
  extension: string | null;
  role: string | null;
  coverage_weekday: string | null;
  coverage_weekend: string | null;
  sort_order: number;
};

export async function fetchAssignmentCodes(area: string): Promise<AssignmentCode[]> {
  const { data } = await supabase
    .from("assignment_codes")
    .select("*")
    .eq("area", area)
    .order("sort_order");
  return (data as AssignmentCode[]) ?? [];
}

export async function fetchZoneReference(area: string): Promise<ZoneReferenceRow[]> {
  const { data } = await supabase
    .from("zone_reference")
    .select("*")
    .eq("area", area)
    .order("sort_order");
  return (data as ZoneReferenceRow[]) ?? [];
}

/** Codes valid for one schedule (area + day/night layer). */
export function codesForLayer(codes: AssignmentCode[], layer: "day" | "night" | "all"): AssignmentCode[] {
  return codes.filter((c) => c.layer === layer || c.layer === "all");
}

/** Team leader / zone leader assignment numbers, derived from the reference table. */
export function leaderAssignmentNos(ref: ZoneReferenceRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of ref) {
    const txt = `${r.label ?? ""} ${r.role ?? ""}`.toLowerCase();
    if (!r.assignment_no) continue;
    if (txt.includes("tl") || txt.includes("zone leader") || txt.includes("team leader")) {
      out.add(r.assignment_no.toUpperCase());
    }
  }
  return out;
}

/** Is this person's shift on that day a team-leader / zone-leader assignment? */
export function isLeaderShift(shift: RosterShift | undefined, ref: ZoneReferenceRow[]): boolean {
  if (!shift?.unit_code) return false;
  return leaderAssignmentNos(ref).has(shift.unit_code.toUpperCase());
}

/** Assistants coverage flips between weekday and weekend definitions. */
export function assistantCoverage(row: ZoneReferenceRow, isWeekend: boolean): string {
  return (isWeekend ? row.coverage_weekend : row.coverage_weekday) ?? "";
}
