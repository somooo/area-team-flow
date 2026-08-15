import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { NoAccess } from "@/components/NoAccess";
import { useCapabilities } from "@/lib/use-can";
import { useDirectoryAreas } from "@/lib/areas";
import { useMe } from "@/lib/use-me";
import {
  CAPABILITIES,
  CATEGORY_ORDER,
  type Capability,
  type CapabilityActor,
  explain,
  isAssignmentActive,
  loadActor,
} from "@/lib/capabilities";

export const Route = createFileRoute("/_authenticated/roles")({
  head: () => ({
    meta: [
      { title: "Roles & permissions — KADIR Staff Management" },
      { name: "description", content: "Define roles, choose their capabilities, assign them to staff by area and inspect anyone's effective permissions." },
      { property: "og:title", content: "Roles & permissions — KADIR Staff Management" },
      { property: "og:description", content: "Manage roles, capabilities and role assignments for hospital staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RolesPage,
});

type Role = { id: string; key: string; label: string; description: string | null; is_builtin: boolean; is_superuser: boolean; sort_order: number };
type RoleCap = { role_id: string; capability_key: string };
type StaffLite = { id: string; name: string; email: string; area: string | null; is_active: boolean };
type Assignment = {
  id: string; staff_id: string; role_id: string; area: string | null;
  start_date: string | null; end_date: string | null; revoked_at: string | null; reason: string | null;
};

const ALL_AREAS = "__all__";

function RolesPage() {
  const { can, loading: capsLoading, reload } = useCapabilities();
  const { me } = useMe();
  const { areas } = useDirectoryAreas();
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleCaps, setRoleCaps] = useState<RoleCap[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: r }, { data: rc }, { data: s }, { data: a }] = await Promise.all([
      supabase.from("roles").select("id,key,label,description,is_builtin,is_superuser,sort_order").order("sort_order"),
      supabase.from("role_capabilities").select("role_id,capability_key"),
      supabase.from("staff").select("id,name,email,area,is_active").order("name"),
      supabase.from("role_assignments").select("id,staff_id,role_id,area,start_date,end_date,revoked_at,reason"),
    ]);
    setRoles((r ?? []) as Role[]);
    setRoleCaps((rc ?? []) as RoleCap[]);
    setStaff(((s ?? []) as StaffLite[]).filter((x) => x.email));
    setAssignments((a ?? []) as Assignment[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const canManageRoles = can("roles.manage");
  const canAssign = can("assignments.manage");

  if (capsLoading) return null;
  if (!canManageRoles && !canAssign) return <NoAccess what="Manage roles" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl uppercase tracking-[0.12em]">Roles &amp; permissions</h1>
        <p className="text-sm text-muted-foreground">
          Capabilities are fixed in code. Roles bundle them, and assignments give a role to a person in an area.
          Nothing is inferred from job titles.
        </p>
      </div>
      <Tabs defaultValue={canManageRoles ? "roles" : "assignments"}>
        <TabsList>
          {canManageRoles && <TabsTrigger value="roles">Roles</TabsTrigger>}
          {canAssign && <TabsTrigger value="assignments">Assignments</TabsTrigger>}
          <TabsTrigger value="viewer">Effective permissions</TabsTrigger>
        </TabsList>

        {canManageRoles && (
          <TabsContent value="roles" className="mt-4">
            <RolesPanel
              roles={roles}
              roleCaps={roleCaps}
              busy={busy}
              setBusy={setBusy}
              reload={async () => { await load(); reload(); }}
            />
          </TabsContent>
        )}

        {canAssign && (
          <TabsContent value="assignments" className="mt-4">
            <AssignmentsPanel
              roles={roles}
              staff={staff}
              assignments={assignments}
              areas={areas}
              actorEmail={me?.staff?.email ?? me?.authEmail ?? ""}
              busy={busy}
              setBusy={setBusy}
              reload={async () => { await load(); reload(); }}
            />
          </TabsContent>
        )}

        <TabsContent value="viewer" className="mt-4">
          <ViewerPanel staff={staff} areas={areas} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RolesPanel({ roles, roleCaps, busy, setBusy, reload }: {
  roles: Role[]; roleCaps: RoleCap[]; busy: boolean;
  setBusy: (b: boolean) => void; reload: () => Promise<void>;
}) {
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const has = (roleId: string, key: Capability) =>
    roleCaps.some((rc) => rc.role_id === roleId && rc.capability_key === key);

  const toggle = async (role: Role, key: Capability, next: boolean) => {
    if (role.is_superuser) { toast.info(`${role.label} always has every capability`); return; }
    setBusy(true);
    const { error } = next
      ? await supabase.from("role_capabilities").insert({ role_id: role.id, capability_key: key })
      : await supabase.from("role_capabilities").delete().eq("role_id", role.id).eq("capability_key", key);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    await reload();
  };

  const addRole = async () => {
    const key = newKey.trim().toLowerCase().replace(/\s+/g, "_");
    const label = newLabel.trim();
    if (!key || !label) { toast.error("Key and label are required"); return; }
    setBusy(true);
    const { error } = await supabase.from("roles").insert({ key, label, sort_order: roles.length + 10 });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setNewKey(""); setNewLabel("");
    toast.success(`Role "${label}" created`);
    await reload();
  };

  const removeRole = async (role: Role) => {
    if (role.is_builtin) { toast.error("Built-in roles can't be deleted"); return; }
    if (!window.confirm(`Delete the role "${role.label}"? Assignments using it are removed.`)) return;
    setBusy(true);
    const { error } = await supabase.from("roles").delete().eq("id", role.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Role deleted");
    await reload();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Roles and their capabilities</CardTitle>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Key</Label>
            <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="charge_nurse" className="w-40" />
          </div>
          <div>
            <Label className="text-xs">Label</Label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Charge nurse" className="w-44" />
          </div>
          <Button size="sm" disabled={busy} onClick={() => void addRole()}>Add role</Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 min-w-[260px]">Capability</th>
              {roles.map((r) => (
                <th key={r.id} className="py-2 px-2 text-center whitespace-nowrap">
                  <div className="font-medium text-foreground">{r.label}</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    {r.is_superuser && <Badge variant="secondary">all</Badge>}
                    {r.is_builtin ? <Badge variant="outline">built-in</Badge> : (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={busy} onClick={() => void removeRole(r)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((cat) => (
              <>
                <tr key={cat} className="border-t">
                  <td colSpan={roles.length + 1} className="py-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {cat}
                  </td>
                </tr>
                {CAPABILITIES.filter((c) => c.category === cat).map((c) => (
                  <tr key={c.key} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{c.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.description} {c.areaScoped ? "· per area" : "· global"}
                      </div>
                    </td>
                    {roles.map((r) => (
                      <td key={r.id} className="py-2 px-2 text-center">
                        <Checkbox
                          checked={r.is_superuser || has(r.id, c.key)}
                          disabled={busy || r.is_superuser}
                          onCheckedChange={(v) => void toggle(r, c.key, v === true)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function AssignmentsPanel({ roles, staff, assignments, areas, actorEmail, busy, setBusy, reload }: {
  roles: Role[]; staff: StaffLite[]; assignments: Assignment[]; areas: string[];
  actorEmail: string; busy: boolean; setBusy: (b: boolean) => void; reload: () => Promise<void>;
}) {
  const [staffId, setStaffId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [area, setArea] = useState(ALL_AREAS);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const visible = assignments.filter((a) => {
    const s = staffById.get(a.staff_id);
    if (!s) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${s.name} ${s.email} ${a.area ?? ""} ${roleById.get(a.role_id)?.label ?? ""}`.toLowerCase().includes(q);
  });

  const grant = async () => {
    if (!staffId || !roleId) { toast.error("Pick a person and a role"); return; }
    setBusy(true);
    const { error } = await supabase.from("role_assignments").insert({
      staff_id: staffId,
      role_id: roleId,
      area: area === ALL_AREAS ? null : area,
      start_date: startDate || null,
      end_date: endDate || null,
      reason: reason || null,
      granted_by_email: actorEmail,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setReason(""); setStartDate(""); setEndDate("");
    toast.success("Role assigned");
    await reload();
  };

  const revoke = async (a: Assignment) => {
    setBusy(true);
    const { error } = await supabase.from("role_assignments")
      .update({ revoked_at: new Date().toISOString(), revoked_by_email: actorEmail })
      .eq("id", a.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Assignment revoked");
    await reload();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Assign a role</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">Person</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} {s.is_active ? "" : "(inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Area</Label>
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_AREAS}>All areas</SelectItem>
                {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Starts (optional)</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Ends (optional — use for cover)</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Covering annual leave" />
          </div>
          <div className="md:col-span-3">
            <Button disabled={busy} onClick={() => void grant()}>Assign role</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Current assignments</CardTitle>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-56" />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Person</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Area</th>
                <th className="py-2 pr-3">Window</th>
                <th className="py-2 pr-3">State</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const s = staffById.get(a.staff_id)!;
                const r = roleById.get(a.role_id);
                const active = isAssignmentActive({
                  id: a.id, roleKey: r?.key ?? "", roleLabel: r?.label ?? "", isSuperuser: !!r?.is_superuser,
                  capabilities: [], area: a.area, startDate: a.start_date, endDate: a.end_date, revokedAt: a.revoked_at,
                });
                return (
                  <tr key={a.id} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.email}{s.is_active ? "" : " · inactive"}</div>
                    </td>
                    <td className="py-2 pr-3">{r?.label ?? "—"}</td>
                    <td className="py-2 pr-3">{a.area ?? "All areas"}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {a.start_date ?? "—"} → {a.end_date ?? "—"}
                      {a.reason ? <div>{a.reason}</div> : null}
                    </td>
                    <td className="py-2 pr-3">
                      {a.revoked_at ? <Badge variant="outline">revoked</Badge>
                        : active ? <Badge variant="secondary">active</Badge>
                        : <Badge variant="outline">scheduled/expired</Badge>}
                    </td>
                    <td className="py-2">
                      {!a.revoked_at && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(a)}>Revoke</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No assignments.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function ViewerPanel({ staff, areas }: { staff: StaffLite[]; areas: string[] }) {
  const [staffId, setStaffId] = useState("");
  const [area, setArea] = useState(ALL_AREAS);
  const [actor, setActor] = useState<CapabilityActor>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!staffId) { setActor(null); return; }
    setLoading(true);
    void loadActor(staffId).then((a) => { setActor(a); setLoading(false); });
  }, [staffId]);

  const rows = explain(actor, area === ALL_AREAS ? null : area);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Effective permissions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Person</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">In area</Label>
            <Select value={area} onValueChange={setArea}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_AREAS}>Not area-specific</SelectItem>
                {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && staffId && actor && !actor.isActive && (
          <p className="text-sm text-destructive">This person is inactive — all access is withdrawn except editing their own profile.</p>
        )}
        {!loading && staffId && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Capability</th>
                  <th className="py-2 pr-3">Granted</th>
                  <th className="py-2 pr-3">Via</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ capability, granted, via }) => (
                  <tr key={capability.key} className="border-t">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{capability.label}</div>
                      <div className="text-xs text-muted-foreground">{capability.key}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {granted ? <Badge variant="secondary">yes</Badge> : <Badge variant="outline">no</Badge>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {via ? `${via.roleLabel}${via.area ? ` · ${via.area}` : " · all areas"}${via.endDate ? ` · until ${via.endDate}` : ""}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
