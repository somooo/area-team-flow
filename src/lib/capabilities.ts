/**
 * The single definition of who can do what.
 *
 * Three separate things, deliberately:
 *  - Capabilities: the fixed vocabulary of actions. Owned by CODE (this file,
 *    mirrored into the `capabilities` table by migration). Never editable in the UI.
 *  - Roles: named bundles of capabilities. Owned by ADMINS, in the database.
 *  - Assignments: who holds which role, in which area, between which dates.
 *
 * Privileges are NEVER inferred from Position, Assigned to, or Status text.
 * `can()` here mirrors the SQL function `public.can(action, area)` exactly;
 * the parity test asserts the two layers agree.
 */
import { supabase } from "@/integrations/supabase/client";

export type CapabilityCategory =
  | "Schedule"
  | "Leave"
  | "Requests"
  | "Directory"
  | "Reports"
  | "System";

export type Capability =
  | "schedule.view"
  | "schedule.edit"
  | "schedule.import"
  | "schedule.replace_month"
  | "leave.view"
  | "leave.request_own"
  | "leave.cancel_own"
  | "leave.approve"
  | "leave.manage"
  | "leave.import"
  | "request.create_own"
  | "request.accept_own"
  | "request.approve"
  | "directory.view"
  | "directory.edit"
  | "directory.import"
  | "profile.edit_own"
  | "reports.view"
  | "codes.manage"
  | "overrides.manage"
  | "settings.manage"
  | "audit.view"
  | "roles.manage"
  | "assignments.manage";

export type CapabilityMeta = {
  key: Capability;
  label: string;
  category: CapabilityCategory;
  areaScoped: boolean;
  description: string;
};

/** Mirrors the seeded `capabilities` table. Code owns this vocabulary. */
export const CAPABILITIES: CapabilityMeta[] = [
  { key: "schedule.view", label: "View schedules", category: "Schedule", areaScoped: false, description: "See the monthly schedule grid for any area." },
  { key: "schedule.edit", label: "Edit schedule", category: "Schedule", areaScoped: true, description: "Change shift cells in an area schedule." },
  { key: "schedule.import", label: "Import schedule", category: "Schedule", areaScoped: true, description: "Upload an Excel schedule for an area." },
  { key: "schedule.replace_month", label: "Replace a schedule month", category: "Schedule", areaScoped: true, description: "Wipe and replace a whole month during import." },
  { key: "leave.view", label: "View leave", category: "Leave", areaScoped: true, description: "See leave and vacation records for an area." },
  { key: "leave.request_own", label: "Request own leave", category: "Leave", areaScoped: false, description: "Submit a leave request for yourself." },
  { key: "leave.cancel_own", label: "Cancel own leave", category: "Leave", areaScoped: false, description: "Cancel or request a change to your own pending leave." },
  { key: "leave.approve", label: "Approve leave", category: "Leave", areaScoped: true, description: "Approve or reject leave requests in an area." },
  { key: "leave.manage", label: "Manage leave", category: "Leave", areaScoped: true, description: "Directly edit, adjust or cancel anyone's leave in an area." },
  { key: "leave.import", label: "Import leave", category: "Leave", areaScoped: true, description: "Bulk import vacations from Excel." },
  { key: "request.create_own", label: "Create own requests", category: "Requests", areaScoped: false, description: "Raise pre-schedule, swap or overtime requests for yourself." },
  { key: "request.accept_own", label: "Respond to own requests", category: "Requests", areaScoped: false, description: "Accept or decline a request that names you." },
  { key: "request.approve", label: "Approve requests", category: "Requests", areaScoped: true, description: "Approve or reject schedule and pre-schedule requests in an area." },
  { key: "directory.view", label: "View staff directory", category: "Directory", areaScoped: true, description: "See staff records for an area." },
  { key: "directory.edit", label: "Edit staff directory", category: "Directory", areaScoped: true, description: "Add, edit or remove staff records in an area." },
  { key: "directory.import", label: "Import staff directory", category: "Directory", areaScoped: true, description: "Bulk import staff records from Excel." },
  { key: "profile.edit_own", label: "Edit own profile", category: "Directory", areaScoped: false, description: "Change your own contact details." },
  { key: "reports.view", label: "View reports", category: "Reports", areaScoped: true, description: "Open reports and exports for an area." },
  { key: "codes.manage", label: "Manage codes and reference data", category: "System", areaScoped: true, description: "Edit assignment codes, zones and import profiles." },
  { key: "overrides.manage", label: "Manage shift overrides", category: "System", areaScoped: true, description: "Set regular-shift overrides for staff." },
  { key: "settings.manage", label: "Manage system settings", category: "System", areaScoped: false, description: "Change system rules and caps." },
  { key: "audit.view", label: "View audit log", category: "System", areaScoped: false, description: "Read the audit trail." },
  { key: "roles.manage", label: "Manage roles", category: "System", areaScoped: false, description: "Create roles and change which capabilities they include." },
  { key: "assignments.manage", label: "Assign roles to people", category: "System", areaScoped: true, description: "Grant or revoke roles for staff in an area." },
];

const AREA_SCOPED = new Map(CAPABILITIES.map((c) => [c.key as string, c.areaScoped]));

export const CATEGORY_ORDER: CapabilityCategory[] = [
  "Schedule",
  "Leave",
  "Requests",
  "Directory",
  "Reports",
  "System",
];

export type ResolvedAssignment = {
  id: string;
  roleKey: string;
  roleLabel: string;
  isSuperuser: boolean;
  capabilities: string[];
  area: string | null;
  startDate: string | null;
  endDate: string | null;
  revokedAt: string | null;
  reason?: string | null;
};

export type CapabilityActor = {
  staffId: string;
  email: string;
  name?: string;
  isActive: boolean;
  assignments: ResolvedAssignment[];
} | null;

function todayISO() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** An assignment currently in force (not revoked, inside its date window). */
export function isAssignmentActive(a: ResolvedAssignment, on = todayISO()): boolean {
  if (a.revokedAt) return false;
  if (a.startDate && a.startDate > on) return false;
  if (a.endDate && a.endDate < on) return false;
  return true;
}

/** Assignments that are dated (i.e. covering) and in force right now. */
export function activeCoverAssignments(actor: CapabilityActor): ResolvedAssignment[] {
  if (!actor?.isActive) return [];
  return actor.assignments.filter((a) => isAssignmentActive(a) && !!a.endDate);
}

/**
 * The one permission check. Mirrors public.can(action, area) in SQL.
 * An inactive staff member has nothing but profile.edit_own.
 */
export function can(actor: CapabilityActor, action: Capability, area?: string | null): boolean {
  if (!actor) return false;
  if (!actor.isActive) return action === "profile.edit_own";
  const areaScoped = AREA_SCOPED.get(action) ?? true;
  for (const a of actor.assignments) {
    if (!isAssignmentActive(a)) continue;
    if (a.isSuperuser) return true;
    if (!a.capabilities.includes(action)) continue;
    if (!areaScoped || a.area === null || a.area === area) return true;
  }
  return false;
}

/** Every capability the actor holds in the given area, with the reason why. */
/** True when the actor holds the capability in at least one area. */
export function canAnywhere(actor: CapabilityActor, action: Capability): boolean {
  if (!actor) return false;
  if (!actor.isActive) return action === "profile.edit_own";
  const areaScoped = AREA_SCOPED.get(action) ?? true;
  return actor.assignments.some(
    (a) =>
      isAssignmentActive(a) &&
      (a.isSuperuser || (a.capabilities.includes(action) && (!areaScoped || true))),
  );
}

/** Areas in which the actor holds the capability; null means "all areas". */
export function areasFor(actor: CapabilityActor, action: Capability): (string | null)[] {
  if (!actor?.isActive) return [];
  return actor.assignments
    .filter((a) => isAssignmentActive(a) && (a.isSuperuser || a.capabilities.includes(action)))
    .map((a) => (a.isSuperuser ? null : a.area));
}

export function explain(
  actor: CapabilityActor,
  area?: string | null,
): { capability: CapabilityMeta; granted: boolean; via: ResolvedAssignment | null }[] {
  return CAPABILITIES.map((capability) => {
    let via: ResolvedAssignment | null = null;
    if (actor && (actor.isActive || capability.key === "profile.edit_own")) {
      for (const a of actor.assignments) {
        if (!isAssignmentActive(a)) continue;
        const hit =
          a.isSuperuser ||
          (a.capabilities.includes(capability.key) &&
            (!capability.areaScoped || a.area === null || a.area === area));
        if (hit) {
          via = a;
          break;
        }
      }
    }
    return { capability, granted: !!via, via };
  });
}

type AssignmentRow = {
  id: string;
  area: string | null;
  start_date: string | null;
  end_date: string | null;
  revoked_at: string | null;
  reason: string | null;
  role_id: string;
};

/** Load the full capability set for one staff member (used for self and for the viewer). */
/** Server-side check, used by route guards before the page loads. */
export async function canServer(action: Capability, area?: string | null): Promise<boolean> {
  const { data } = await supabase.rpc("can", { _action: action, _area: area ?? undefined });
  return data === true;
}

export async function loadActor(staffId: string): Promise<CapabilityActor> {
  const { data: staff } = await supabase
    .from("staff")
    .select("id,email,name,is_active")
    .eq("id", staffId)
    .maybeSingle();
  if (!staff) return null;

  const [{ data: assignments }, { data: roles }, { data: caps }] = await Promise.all([
    supabase
      .from("role_assignments")
      .select("id,area,start_date,end_date,revoked_at,reason,role_id")
      .eq("staff_id", staffId),
    supabase.from("roles").select("id,key,label,is_superuser"),
    supabase.from("role_capabilities").select("role_id,capability_key"),
  ]);

  const roleById = new Map(
    ((roles ?? []) as { id: string; key: string; label: string; is_superuser: boolean }[]).map((r) => [r.id, r]),
  );
  const capsByRole = new Map<string, string[]>();
  for (const rc of (caps ?? []) as { role_id: string; capability_key: string }[]) {
    const list = capsByRole.get(rc.role_id) ?? [];
    list.push(rc.capability_key);
    capsByRole.set(rc.role_id, list);
  }

  const resolved: ResolvedAssignment[] = ((assignments ?? []) as AssignmentRow[]).flatMap((a) => {
    const role = roleById.get(a.role_id);
    if (!role) return [];
    return [
      {
        id: a.id,
        roleKey: role.key,
        roleLabel: role.label,
        isSuperuser: role.is_superuser,
        capabilities: capsByRole.get(a.role_id) ?? [],
        area: a.area,
        startDate: a.start_date,
        endDate: a.end_date,
        revokedAt: a.revoked_at,
        reason: a.reason,
      },
    ];
  });

  return {
    staffId: staff.id as string,
    email: (staff.email as string | null) ?? "",
    name: (staff.name as string | null) ?? undefined,
    isActive: (staff as { is_active?: boolean }).is_active !== false,
    assignments: resolved,
  };
}

export type CapabilityHolder = {
  staffId: string;
  email: string;
  name: string;
  area: string | null;
  /** null = holds the capability in every area. */
  areas: (string | null)[];
};

/**
 * Everyone who currently holds a capability (optionally in a given area).
 * Used wherever the app needs "the people who can approve/cover", so eligibility
 * comes from role assignments — never from job-title or area text.
 */
export async function fetchCapabilityHolders(
  action: Capability,
  area?: string | null,
): Promise<CapabilityHolder[]> {
  const [{ data: assignments }, { data: roles }, { data: caps }, { data: staff }] = await Promise.all([
    supabase.from("role_assignments").select("staff_id,area,start_date,end_date,revoked_at,role_id"),
    supabase.from("roles").select("id,is_superuser"),
    supabase.from("role_capabilities").select("role_id,capability_key"),
    supabase.from("staff").select("id,email,name,area,is_active"),
  ]);

  const superRoles = new Set(
    ((roles ?? []) as { id: string; is_superuser: boolean }[]).filter((r) => r.is_superuser).map((r) => r.id),
  );
  const capsByRole = new Map<string, Set<string>>();
  for (const rc of (caps ?? []) as { role_id: string; capability_key: string }[]) {
    const set = capsByRole.get(rc.role_id) ?? new Set<string>();
    set.add(rc.capability_key);
    capsByRole.set(rc.role_id, set);
  }
  const areaScoped = AREA_SCOPED.get(action) ?? true;
  const byStaff = new Map<string, (string | null)[]>();
  type Row = { staff_id: string; area: string | null; start_date: string | null; end_date: string | null; revoked_at: string | null; role_id: string };
  for (const a of (assignments ?? []) as Row[]) {
    const active = isAssignmentActive({
      id: "", roleKey: "", roleLabel: "", isSuperuser: false, capabilities: [],
      area: a.area, startDate: a.start_date, endDate: a.end_date, revokedAt: a.revoked_at,
    });
    if (!active) continue;
    const isSuper = superRoles.has(a.role_id);
    if (!isSuper && !capsByRole.get(a.role_id)?.has(action)) continue;
    const grantArea = isSuper ? null : a.area;
    if (areaScoped && area !== undefined && grantArea !== null && grantArea !== area) continue;
    const list = byStaff.get(a.staff_id) ?? [];
    list.push(grantArea);
    byStaff.set(a.staff_id, list);
  }

  const out: CapabilityHolder[] = [];
  for (const s of (staff ?? []) as { id: string; email: string | null; name: string | null; area: string | null; is_active?: boolean }[]) {
    if (s.is_active === false) continue;
    const areas = byStaff.get(s.id);
    if (!areas) continue;
    out.push({ staffId: s.id, email: (s.email ?? "").toLowerCase(), name: s.name ?? s.email ?? "", area: s.area, areas });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
