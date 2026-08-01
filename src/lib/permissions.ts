/**
 * Central permission model.
 *
 * Admin is an unrestricted override: every area-scoped check in the app funnels
 * through these helpers, so any future area, schedule type or approval category
 * is automatically visible and editable to admins without per-screen changes.
 * Mirrors the database rules (`is_admin()` short-circuits `is_area_manager_of()`
 * and `is_supervisor_of()` in RLS).
 */
export type AppRole = "staff" | "supervisor" | "admin" | "team_leader";

export type Actor = { role: AppRole; area?: string | null; email?: string } | null | undefined;

export function isAdmin(actor: Actor): boolean {
  return actor?.role === "admin";
}

/** Can act as a manager (schedule edits, staff, assignments, reference tables) in this area. */
export function canManageArea(actor: Actor, area?: string | null): boolean {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  if (!area) return false;
  return (actor.role === "supervisor" || actor.role === "team_leader") && actor.area === area;
}

/** Can view an area's schedules / calendars. */
export function canViewArea(actor: Actor, area?: string | null): boolean {
  if (!actor) return false;
  if (isAdmin(actor)) return true;
  return actor.role !== "staff" || actor.area === area;
}

/** Can approve or reject a pending request belonging to this area. */
export function canApproveIn(actor: Actor, area?: string | null): boolean {
  return canManageArea(actor, area);
}

/** Can see and act on the shared Supervisors vacation calendar. */
export function canUseSupervisorsCalendar(actor: Actor): boolean {
  return isAdmin(actor) || actor?.role === "supervisor";
}

/** Can directly adjust/cancel someone else's vacation (no extra approval step). */
export function canManageVacationsIn(actor: Actor, area: string, supervisorsArea: string): boolean {
  if (isAdmin(actor)) return true;
  if (area === supervisorsArea) return false;
  return canManageArea(actor, area);
}
