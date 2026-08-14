import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ExcelImportButton, type ImportItem, type CommitReport } from "@/components/ExcelImportButton";
import { downloadSheet } from "@/lib/xlsx-io";
import { canServer } from "@/lib/capabilities";
import { useCapabilities } from "@/lib/use-can";
import { NoAccess } from "@/components/NoAccess";
import { logAudit } from "@/lib/audit";
import {
  cell, isFormula, isProtectedTest, normalizeBadge, parseHireDate, readStaffRows, text,
} from "@/lib/staff-import";

export const Route = createFileRoute("/_authenticated/directory")({
  // Route-level gate: the same capability the nav link uses, so deep links match the menu.
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user?.email) throw redirect({ to: "/auth" });
    if (!(await canServer("directory.view"))) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Staff Directory — KADIR Staff Management" },
      { name: "description", content: "Searchable staff roster with inline editing, custom columns and Excel import/export." },
      { property: "og:title", content: "Staff Directory — KADIR Staff Management" },
      { property: "og:description", content: "Searchable staff roster with inline editing, custom columns and Excel import/export." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DirectoryPage,
});

const POSITIONS = ["RT I", "RT I SANG", "RT II", "RT III", "RT III SANG", "RT III SCDP", "RT Supervisor", "Supervisor", "RT Educator", "Manager", "Med Sec II", "Admin Asst."];
const ASSIGNED = ["ICU", "Wards", "Assistants", "Supervisor", "Admin", "RT PFT", "RT Pulmonary Rehabilitation", "SCDP"];
const STATUSES = ["Active", "Inactive"];

type CustomCol = { id: string; key: string; label: string; sort_order: number };

type Row = {
  id: string;
  name: string; first_name: string | null; last_name: string | null;
  position: string | null; badge_id: string | null; date_of_hire: string | null;
  email: string | null; assigned_to: string | null; status: string;
  supervisor: string | null; supervisor_email: string | null;
  extension: string | null; notes: string | null;
  area: string | null;
  shift_base_override: number | null;
  custom_fields: Record<string, string> | null;
};

type ColDef = {
  key: string; label: string;
  type: "text" | "date" | "select";
  options?: string[];
  custom?: boolean;
};

const BASE_COLUMNS: ColDef[] = [
  { key: "name", label: "Full Name", type: "text" },
  { key: "first_name", label: "First Name", type: "text" },
  { key: "last_name", label: "Last Name", type: "text" },
  { key: "position", label: "Position", type: "select", options: POSITIONS },
  { key: "badge_id", label: "BADGE", type: "text" },
  { key: "date_of_hire", label: "Date of Hire", type: "date" },
  { key: "email", label: "EMAIL", type: "text" },
  { key: "assigned_to", label: "Assigned to", type: "select", options: ASSIGNED },
  { key: "status", label: "Status", type: "select", options: STATUSES },
  { key: "supervisor", label: "Supervisor", type: "text" },
  { key: "supervisor_email", label: "Supervisor Email", type: "text" },
  { key: "extension", label: "Extension", type: "text" },
  { key: "notes", label: "Notes", type: "text" },
  { key: "shift_base_override", label: "Shift base (SANG = 14)", type: "text" },
];

const SELECT_COLS = "id,name,first_name,last_name,position,badge_id,date_of_hire,email,assigned_to,status,supervisor,supervisor_email,extension,notes,area,shift_base_override,custom_fields";

type UpsertPayload = { existingId?: string; values: Record<string, unknown>; badge: string };

const emptyDraft = (): Record<string, string> => ({});

function DirectoryPage() {
  const { me } = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [customCols, setCustomCols] = useState<CustomCol[]>([]);
  const [search, setSearch] = useState("");
  const [fPosition, setFPosition] = useState("");
  const [fAssigned, setFAssigned] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { row: Row; counts: Record<string, number>; total: number; force: boolean; typed: string } | null
  >(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  /** Directory access follows capabilities; the route gate and RLS use the same check. */
  const admin = can("directory.edit");
  const allowed = can("directory.view") || admin;

  const load = useCallback(async () => {
    const [{ data: st }, { data: cc }] = await Promise.all([
      supabase.from("staff").select(SELECT_COLS).order("name"),
      supabase.from("staff_custom_columns").select("*").order("sort_order"),
    ]);
    setRows(((st ?? []) as unknown as Row[]).map((r) => ({ ...r, custom_fields: (r.custom_fields ?? {}) as Record<string, string> })));
    setCustomCols((cc as CustomCol[]) ?? []);
  }, []);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  const columns: ColDef[] = useMemo(
    () => [...BASE_COLUMNS, ...customCols.map((c) => ({ key: c.key, label: c.label, type: "text" as const, custom: true }))],
    [customCols],
  );

  const filtersActive = !!(search.trim() || fPosition || fAssigned || fStatus);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      (!q || [r.name, r.first_name, r.last_name, r.email, r.badge_id].some((v) => (v ?? "").toLowerCase().includes(q))) &&
      (!fPosition || (r.position ?? "") === fPosition) &&
      (!fAssigned || (r.assigned_to ?? "") === fAssigned) &&
      (!fStatus || (r.status ?? "") === fStatus));
  }, [rows, search, fPosition, fAssigned, fStatus]);

  const valueOf = (r: Row, col: ColDef): string => {
    if (col.custom) return (r.custom_fields ?? {})[col.key] ?? "";
    const v = (r as unknown as Record<string, unknown>)[col.key];
    return v == null ? "" : String(v);
  };

  const saveCell = async (r: Row, col: ColDef, value: string) => {
    if (valueOf(r, col) === value) { setEditing(null); return; }
    const patch: Record<string, unknown> = col.custom
      ? { custom_fields: { ...(r.custom_fields ?? {}), [col.key]: value } }
      : col.key === "shift_base_override"
      ? { shift_base_override: value.trim() === "" ? null : Number(value) }
      : { [col.key]: value === "" ? (col.key === "status" ? "Active" : null) : value };
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, ...(col.custom ? { custom_fields: patch.custom_fields as Record<string, string> } : patch) } as Row : x)));
    setEditing(null);
    const { error } = await supabase.from("staff").update(patch as never).eq("id", r.id);
    if (error) { toast.error(error.message); void load(); }
  };

  // ---------------------------------------------------------------- draft row
  const startDraft = () => {
    if (draft) { draftRef.current?.focus(); return; }
    setDraft(emptyDraft());
    requestAnimationFrame(() => {
      draftRef.current?.focus();
      draftRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const jumpTo = (id: string) => {
    setHighlight(id);
    requestAnimationFrame(() => rowRefs.current[id]?.scrollIntoView({ block: "center", behavior: "smooth" }));
    window.setTimeout(() => setHighlight((h) => (h === id ? null : h)), 2500);
  };

  const saveDraft = async () => {
    if (!draft) return;
    const badge = (draft.badge_id ?? "").trim();
    if (!badge) { toast.error("Badge is required"); return; }
    const clash = rows.find((r) => normalizeBadge(r.badge_id) === normalizeBadge(badge));
    if (clash) {
      toast.error(`Badge ${badge} already in directory`);
      setDraft(null);
      jumpTo(clash.id);
      return;
    }
    setSavingDraft(true);
    const values: Record<string, unknown> = { role: "staff", status: draft.status?.trim() || "Active", badge_id: badge };
    for (const c of columns) {
      if (c.key === "badge_id" || c.key === "status") continue;
      const v = (draft[c.key] ?? "").trim();
      if (c.custom) continue;
      if (c.key === "shift_base_override") { if (v) values.shift_base_override = Number(v) || null; continue; }
      values[c.key] = v === "" ? null : c.key === "email" ? v.toLowerCase() : v;
    }
    const custom: Record<string, string> = {};
    for (const c of columns) if (c.custom && (draft[c.key] ?? "").trim()) custom[c.key] = draft[c.key].trim();
    if (Object.keys(custom).length) values.custom_fields = custom;
    if (!values.name) values.name = ""; // name is required by the database but may be blank

    const { data, error } = await supabase.from("staff").insert(values as never).select("id").maybeSingle();
    setSavingDraft(false);
    if (error) { toast.error(error.message); return; }
    setDraft(null);
    await load();
    toast.success(`Badge ${badge} added`);
    if (data?.id) jumpTo(data.id);
  };

  // ------------------------------------------------------------------ delete
  const askDelete = async (r: Row) => {
    const protectedRow = isProtectedTest(r);
    const { data, error } = await supabase.rpc("staff_dependents", { _id: r.id });
    if (error) { toast.error(error.message); return; }
    const counts = (data ?? {}) as Record<string, number>;
    const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
    setPendingDelete({ row: r, counts, total, force: protectedRow, typed: "" });
  };

  const runDelete = async (cascade: boolean) => {
    if (!pendingDelete) return;
    const { row, force } = pendingDelete;
    const { error } = await supabase.rpc("admin_delete_staff", { _id: row.id, _cascade: cascade, _force: force });
    if (error) { toast.error(error.message); return; }
    setPendingDelete(null);
    await load();
    toast.success(`${row.name || row.badge_id} deleted`);
    void logAudit({
      action: cascade ? "staff.delete_with_history" : "staff.delete",
      entity_type: "staff", entity_id: row.id, area: row.area,
      details: { name: row.name, badge_id: row.badge_id },
    });
  };

  const deactivate = async (r: Row) => {
    const { error } = await supabase.from("staff").update({ status: "Inactive" } as never).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    setPendingDelete(null);
    await load();
    toast.success(`${r.name || r.badge_id} set to Inactive — history kept`);
    void logAudit({
      action: "staff.deactivate", entity_type: "staff", entity_id: r.id, area: r.area,
      details: { name: r.name, badge_id: r.badge_id },
    });
  };

  // ----------------------------------------------------------------- columns
  const addColumn = async () => {
    const label = window.prompt("New column name");
    if (!label?.trim()) return;
    const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key) { toast.error("Pick a name with letters or numbers"); return; }
    const { error } = await supabase.from("staff_custom_columns").insert({
      key, label: label.trim(), sort_order: 100 + customCols.length,
    });
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const removeColumn = async (c: CustomCol) => {
    if (!window.confirm(`Remove the "${c.label}" column from the directory?`)) return;
    const { error } = await supabase.from("staff_custom_columns").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const exportDirectory = () => {
    const header = columns.map((c) => c.label);
    const body = filtered.map((r) => columns.map((c) => valueOf(r, c)));
    const date = new Date().toISOString().slice(0, 10);
    downloadSheet(`staff_directory_${date}.xlsx`, "Staff Directory", [header, ...body], columns.map((c) => (c.key === "notes" ? 32 : 18)));
    toast.success(`Exported ${body.length} staff`);
  };

  // ------------------------------------------------------------------ import
  const [importSummary, setImportSummary] = useState<{ kept: number; protectedRows: number; unchanged: number } | null>(null);

  const parseImport = async ({ workbook }: { workbook: { sheetNames: string[]; sheets: Record<string, unknown[][]> } }): Promise<ImportItem<UpsertPayload>[]> => {
    const { rows: sheetRows } = readStaffRows(workbook);
    const byBadge = new Map(rows.filter((r) => normalizeBadge(r.badge_id)).map((r) => [normalizeBadge(r.badge_id), r]));
    const nameToEmail = new Map(
      rows.filter((r) => r.email).map((r) => [(r.name ?? "").trim().toLowerCase(), r.email as string]),
    );
    const seen = new Set<string>();
    let unchanged = 0;
    let protectedRows = 0;

    const items = sheetRows.map((sr, i): ImportItem<UpsertPayload> => {
      const v = sr.values;
      const id = `d${i}`;
      const name = text(v, "Full Name", "Staff Name", "Name");
      const badgeRaw = text(v, "BADGE", "Badge", "Badge Number", "Badge No", "Badge ID");
      const badge = normalizeBadge(badgeRaw);
      const email = text(v, "EMAIL", "Email").toLowerCase();
      const label = name || badgeRaw || `Row ${sr.rowNumber}`;
      const existing = badge ? byBadge.get(badge) : undefined;

      if (!badge) {
        return { id, label, badge: badgeRaw, change: "—", status: "skip", reason: `Row ${sr.rowNumber}: no badge number` };
      }
      if (seen.has(badge)) {
        return { id, label, badge: badgeRaw, change: "—", status: "skip", reason: `Row ${sr.rowNumber}: duplicate badge ${badgeRaw} in the file` };
      }
      seen.add(badge);
      if (existing && isProtectedTest(existing)) {
        protectedRows++;
        return { id, label, badge: badgeRaw, area: existing.assigned_to ?? undefined, change: "—", status: "skip", reason: "Protected test record — untouched" };
      }

      const hire = parseHireDate(cell(v, "Date of Hire", "Hire Date", "Date Of Hire"));
      let supervisorEmail = text(v, "Supervisor Email");
      const supervisorName = text(v, "Supervisor");
      if (!supervisorEmail || isFormula(supervisorEmail)) {
        supervisorEmail = supervisorName ? nameToEmail.get(supervisorName.trim().toLowerCase()) ?? "" : "";
      }

      const values: Record<string, unknown> = {
        name: name || existing?.name || "",
        first_name: text(v, "First Name") || null,
        last_name: text(v, "Last Name") || null,
        position: text(v, "Position") || null,
        badge_id: badgeRaw.trim(),
        date_of_hire: hire.date,
        assigned_to: text(v, "Assigned to", "Assigned To") || null,
        status: text(v, "Status") || "Active",
        supervisor: supervisorName || null,
        supervisor_email: supervisorEmail || null,
        extension: text(v, "Extension") || null,
        notes: text(v, "Notes") || null,
      };
      if (email) values.email = email;

      // SANG staff have a fixed regular-shift base of 14, identifiable from position or assignment.
      const sangText = `${text(v, "Position")} ${text(v, "Assigned to", "Assigned To")}`;
      const baseField = text(v, "Shift base", "Shift base (SANG = 14)");
      if (baseField) values.shift_base_override = Number(baseField) || null;
      else if (/sang/i.test(sangText)) values.shift_base_override = 14;

      const custom: Record<string, string> = {};
      for (const c of customCols) {
        const t = text(v, c.label);
        if (t) custom[c.key] = t;
      }
      if (Object.keys(custom).length) values.custom_fields = custom;

      const warning = hire.warning;

      if (existing) {
        const differs = Object.entries(values).some(([k, val]) => {
          if (k === "custom_fields") return true;
          const cur = (existing as unknown as Record<string, unknown>)[k];
          return (cur ?? null) !== (val ?? null);
        });
        if (!differs) {
          unchanged++;
          return { id, label, badge: badgeRaw, area: values.assigned_to as string, change: "No change", status: "skip", reason: "No change — already matches the file" };
        }
        return {
          id, label, badge: badgeRaw, area: values.assigned_to as string, warning,
          change: `Update badge ${badgeRaw}`, status: "update",
          payload: { existingId: existing.id, values, badge: badgeRaw },
        };
      }
      values.role = "staff";
      return {
        id, label, badge: badgeRaw, area: values.assigned_to as string, warning,
        change: `Add ${name || badgeRaw}`, status: "add",
        payload: { values, badge: badgeRaw },
      };
    });

    const fileBadges = new Set(items.map((i) => normalizeBadge(i.badge)));
    const kept = rows.filter((r) => normalizeBadge(r.badge_id) && !fileBadges.has(normalizeBadge(r.badge_id))).length;
    setImportSummary({ kept, protectedRows, unchanged });
    return items;
  };

  /** Add/update only — rows missing from the file are never deleted or deactivated. */
  const commitImport = async (
    items: ImportItem<UpsertPayload>[],
    { setProgress }: { setProgress: (t: string | null) => void },
  ): Promise<CommitReport> => {
    const failures: string[] = [];
    let written = 0;
    const size = 25;
    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      setProgress(`Writing ${i + 1}–${Math.min(i + size, items.length)} of ${items.length}…`);
      await Promise.all(batch.map(async (it) => {
        const p = it.payload!;
        const clean = Object.fromEntries(Object.entries(p.values).filter(([, v]) => v !== undefined));
        const { error } = p.existingId
          ? await supabase.from("staff").update(clean as never).eq("id", p.existingId)
          : await supabase.from("staff").insert(clean as never);
        if (error) failures.push(`${p.badge} ${it.label}: ${error.message}`);
        else written++;
      }));
    }
    const badges = items.map((i) => i.payload?.badge?.trim()).filter(Boolean) as string[];
    const { data: after } = await supabase.from("staff").select("badge_id").in("badge_id", badges.length ? badges : ["__none__"]);
    await load();
    return { attempted: items.length, written, confirmed: (after ?? []).length, failures };
  };

  if (!me?.staff) return null;
  if (capsLoading) return null;
  if (!allowed) return <NoAccess what="View staff directory" />;

  const draftCellValue = (key: string) => draft?.[key] ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff Directory</h1>
        <p className="text-sm text-muted-foreground">Click any cell to edit. Enter saves, Escape cancels.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            {filtersActive ? `Showing ${filtered.length} of ${rows.length} staff` : `${rows.length} staff`}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <ExcelImportButton<UpsertPayload>
              title="Import staff directory"
              description="Every row is matched on badge number. Rows in the directory but not in the file are kept unchanged — the import never deletes."
              parse={parseImport}
              commit={commitImport}
              extraSummary={() =>
                importSummary ? (
                  <div className="rounded-md border p-2 text-xs text-muted-foreground space-y-0.5">
                    <div>In directory, not in file — kept unchanged: {importSummary.kept} rows</div>
                    <div>Protected test records — untouched: {importSummary.protectedRows} rows</div>
                    <div>No change: {importSummary.unchanged} rows</div>
                  </div>
                ) : null
              }
            />
            <Button size="sm" variant="outline" onClick={exportDirectory}>Export to Excel</Button>
            <Button size="sm" variant="outline" onClick={addColumn}>+ Add Column</Button>
            <Button size="sm" onClick={startDraft}>Add row</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Search</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or badge" />
            </div>
            <FilterSelect label="Position" value={fPosition} onChange={setFPosition} options={Array.from(new Set(rows.map((r) => r.position).filter(Boolean) as string[])).sort()} />
            <FilterSelect label="Assigned to" value={fAssigned} onChange={setFAssigned} options={Array.from(new Set(rows.map((r) => r.assigned_to).filter(Boolean) as string[])).sort()} />
            <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={STATUSES} />
          </div>

          <div className="overflow-auto rounded-md border max-h-[70vh]">
            <table className="w-max min-w-full text-xs">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="w-10 border-b border-r p-2 text-left font-semibold">#</th>
                  {columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap border-b border-r p-2 text-left font-semibold">
                      {c.label}
                      {c.custom && (
                        <button
                          type="button"
                          className="ml-1 text-muted-foreground hover:text-destructive"
                          onClick={() => removeColumn(customCols.find((x) => x.key === c.key)!)}
                          aria-label={`Remove ${c.label} column`}
                        >×</button>
                      )}
                    </th>
                  ))}
                  <th className="border-b p-2" />
                </tr>
              </thead>
              <tbody>
                {draft && (
                  <tr className="bg-copper-50/60">
                    <td className="border-b border-r p-2 align-top">
                      <Badge variant="secondary" className="text-[10px]">New</Badge>
                    </td>
                    {columns.map((c, idx) => (
                      <td key={c.key} className="border-b border-r p-0 align-top">
                        <input
                          ref={idx === 0 ? draftRef : undefined}
                          type={c.type === "date" ? "date" : "text"}
                          value={draftCellValue(c.key)}
                          placeholder={c.key === "badge_id" ? "Badge (required)" : ""}
                          onChange={(e) => setDraft((d) => ({ ...(d ?? {}), [c.key]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveDraft(); } }}
                          className="w-40 border-0 bg-transparent px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-inset focus:ring-steel-500"
                        />
                      </td>
                    ))}
                    <td className="border-b p-1">
                      <div className="flex gap-1">
                        <Button size="sm" className="h-7 text-xs" disabled={savingDraft} onClick={() => void saveDraft()}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={savingDraft} onClick={() => setDraft(null)}>Discard</Button>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map((r, i) => {
                  const prot = isProtectedTest(r);
                  return (
                    <tr
                      key={r.id}
                      ref={(el) => { rowRefs.current[r.id] = el; }}
                      className={`hover:bg-muted/40 ${highlight === r.id ? "bg-copper-100" : ""}`}
                    >
                      <td className="border-b border-r p-2 text-muted-foreground tabular-nums align-top">{i + 1}</td>
                      {columns.map((c) => (
                        <td key={c.key} className="border-b border-r p-0 align-top">
                          <div className="flex items-center gap-1">
                            <EditableCell
                              value={valueOf(r, c)}
                              col={c}
                              editing={editing?.id === r.id && editing.key === c.key}
                              onStart={() => setEditing({ id: r.id, key: c.key })}
                              onCancel={() => setEditing(null)}
                              onSave={(v) => saveCell(r, c, v)}
                            />
                            {c.key === "name" && prot && (
                              <Badge variant="outline" className="mr-1 text-[10px]">Test</Badge>
                            )}
                          </div>
                        </td>
                      ))}
                      <td className="border-b p-1 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={prot && !admin}
                          title={prot ? "Protected test record — deleting requires typing the badge number" : undefined}
                          onClick={() => void askDelete(r)}
                          aria-label={`Delete ${r.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && !draft && (
                  <tr><td colSpan={columns.length + 2} className="p-6 text-center text-muted-foreground">No staff match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pendingDelete?.force ? "Delete protected record" : "Delete staff record"}
            </DialogTitle>
          </DialogHeader>
          {pendingDelete && (
            <div className="space-y-3 text-sm">
              <p>
                <span className="font-medium">{pendingDelete.row.name || "(no name)"}</span>
                {" — badge "}{pendingDelete.row.badge_id ?? "—"}
              </p>
              {pendingDelete.total > 0 ? (
                <p>
                  This person has {pendingDelete.counts.leave_requests ?? 0} vacation records and{" "}
                  {pendingDelete.counts.shifts ?? 0} schedule assignments
                  {(pendingDelete.counts.preschedule_requests ?? 0) + (pendingDelete.counts.schedule_change_requests ?? 0) > 0
                    ? `, plus ${(pendingDelete.counts.preschedule_requests ?? 0) + (pendingDelete.counts.schedule_change_requests ?? 0)} requests`
                    : ""}
                  . Deleting will remove them.
                </p>
              ) : (
                <p className="text-muted-foreground">No schedule or vacation history — the record can be deleted permanently.</p>
              )}
              {pendingDelete.force && (
                <div>
                  <Label className="text-xs">Type the badge number {pendingDelete.row.badge_id} to confirm</Label>
                  <Input
                    value={pendingDelete.typed}
                    onChange={(e) => setPendingDelete((p) => (p ? { ...p, typed: e.target.value } : p))}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            {pendingDelete && pendingDelete.total > 0 && (
              <Button variant="secondary" onClick={() => void deactivate(pendingDelete.row)}>Deactivate instead</Button>
            )}
            <Button
              variant="destructive"
              disabled={!!pendingDelete?.force && pendingDelete.typed.trim() !== (pendingDelete.row.badge_id ?? "").trim()}
              onClick={() => void runDelete((pendingDelete?.total ?? 0) > 0)}
            >
              {(pendingDelete?.total ?? 0) > 0 ? "Delete with history" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
      >
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function EditableCell({ value, col, editing, onStart, onCancel, onSave }: {
  value: string; col: ColDef; editing: boolean;
  onStart: () => void; onCancel: () => void; onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setDraft(value); requestAnimationFrame(() => ref.current?.focus()); } }, [editing, value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={onStart}
        className="block w-full min-w-28 max-w-64 truncate px-2 py-1.5 text-left hover:bg-steel-50"
        title={value}
      >
        {value || <span className="text-muted-foreground">—</span>}
      </button>
    );
  }
  const listId = `dl-${col.key}`;
  return (
    <>
      <input
        ref={ref}
        type={col.type === "date" ? "date" : "text"}
        list={col.type === "select" ? listId : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSave(draft); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className="w-40 border-0 bg-background px-2 py-1.5 text-xs outline-none ring-2 ring-inset ring-steel-500"
      />
      {col.type === "select" && (
        <datalist id={listId}>{(col.options ?? []).map((o) => <option key={o} value={o} />)}</datalist>
      )}
    </>
  );
}
