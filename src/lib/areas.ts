/**
 * Canonical area list.
 *
 * Areas are a fixed part of the organisation, NOT derived from staff data —
 * an area with zero staff must still be selectable everywhere so a supervisor
 * or admin can assign people into it.
 */
export const AREAS = ["ICU", "Wards", "Assistants"] as const;
export type Area = (typeof AREAS)[number];

export const SUPERVISORS_TEAM = "Supervisors";

/** Vacation planner teams: the supervisors calendar plus every area. */
export const VACATION_TEAMS = [SUPERVISORS_TEAM, ...AREAS];

/** Canonical list plus any legacy area values still present in the data. */
export function withKnownAreas(extra: (string | null | undefined)[]): string[] {
  const out = [...AREAS] as string[];
  for (const a of extra) {
    if (a && !out.includes(a) && a !== SUPERVISORS_TEAM) out.push(a);
  }
  return out;
}
