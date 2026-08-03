import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { ExcelImportButton, type ImportItem } from "@/components/ExcelImportButton";
import { downloadSheet, field, toISODateValue } from "@/lib/xlsx-io";
import { isAdmin } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/directory")({
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

const POSITIONS = ["RT I", "RT I SANG", "RT II", "RT III", "RT III SANG", "RT III SCDP", "RT Supervisor", "RT Educator", "Manager", "Med Sec II", "Admin Asst."];
const ASSIGNED = ["RT ICUs", "RT WARDs", "RT SANG", "RT Equipment", "RT PFT", "RT Pulmonary Rehabilitation", "RT Educator", "RT Supervisors", "A/ ICUs Supervisor", "A/ Wards Supervisor", "A/ Quality Supervisors", "A/DIRECTOR", "A/MANAGER", "ADMIN ASSISTANTS", "SCDP"];
const STATUSES = ["Active", "Inactive"];

type CustomCol = { id: string; key: string; label: string; sort_order: number };

type Row = {
  id: string;
  name: string; first_name: string | null; last_name: string | null;
  position: string | null; badge_id: string | null; date_of_hire: string | null;
  email: string; assigned_to: string | null; status: string;
  supervisor: string | null; supervisor_email: string | null;
  extension: string | null; notes: string | null;
  area: string | null;
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
];

const SELECT_COLS = "id,name,first_name,last_name,position,badge_id,date_of_hire,email,assigned_to,status,supervisor,supervisor_email,extension,notes,area,custom_fields";

type UpsertPayload = { existingId?: string; values: Record<string, unknown> };

function DirectoryPage() {
  const { me } = useMe();
  const [rows, setRows] = useState<Row[]>([]);
  const [customCols, setCustomCols] = useState<CustomCol[]>([]);
  const [search, setSearch] = useState("");
  const [fPosition, setFPosition] = useState("");
  const [fAssigned, setFAssigned] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);

  const role = me?.staff?.role;
  const allowed = role === "admin" || role === "supervisor";
  const admin = isAdmin(me?.staff);

  const load = useCallback(async () => {
    const [{ data: st }, { data: cc }] = await Promise.all([
      supabase.from("staff_directory").select(SELECT_COLS).order("name"),
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
      : { [col.key]: value === "" ? (col.key === "status" ? "Active" : null) : value };
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, ...(col.custom ? { custom_fields: patch.custom_fields as Record<string, string> } : patch) } as Row : x)));
    setEditing(null);
    const { error } = await supabase.from("staff").update(patch as never).eq("id", r.id);
    if (error) { toast.error(error.message); void load(); }
  };

  const addRow = async () => {
    const stamp = Date.now();
    const { error } = await supabase.from("staff").insert({
      name: "New staff member",
      email: `new.staff.${stamp}@placeholder.local`,
      role: "staff",
      area: admin ? (me?.staff?.area ?? null) : (me?.staff?.area ?? null),
      status: "Active",
    } as never);
    if (error) { toast.error(error.message); return; }
    toast.success("Row added — fill in the details");
    void load();
  };

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

  const deleteRow = async (r: Row) => {
    if (!window.confirm(`Remove ${r.name} from the staff directory? Their historical schedule and vacation records are kept.`)) return;
    const { error } = await supabase.from("staff").update({ status: "Inactive" } as never).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    setRows((list) => list.filter((x) => x.id !== r.id));
    toast.success("Removed from the active directory");
    void load();
  };

  const exportDirectory = () => {
    const header = columns.map((c) => c.label);
    const body = filtered.map((r) => columns.map((c) => valueOf(r, c)));
    const date = new Date().toISOString().slice(0, 10);
    downloadSheet(`staff_directory_${date}.xlsx`, "Staff Directory", [header, ...body], columns.map((c) => (c.key === "notes" ? 32 : 18)));
    toast.success(`Exported ${body.length} staff`);
  };

  const parseImport = async ({ rows: sheetRows }: { rows: Record<string, unknown>[] }): Promise<ImportItem<UpsertPayload>[]> => {
    const byBadge = new Map(rows.filter((r) => r.badge_id).map((r) => [String(r.badge_id).trim().toLowerCase(), r]));
    const byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r]));
    return sheetRows.map((row, i) => {
      const id = `d${i}`;
      const name = field(row, "Full Name", "Staff Name", "Name");
      const badge = field(row, "BADGE", "Badge", "Badge Number");
      const email = field(row, "EMAIL", "Email");
      const label = name || badge || `Row ${i + 2}`;
      const values: Record<string, unknown> = {
        name: name || undefined,
        first_name: field(row, "First Name") || null,
        last_name: field(row, "Last Name") || null,
        position: field(row, "Position") || null,
        badge_id: badge || null,
        date_of_hire: toISODateValue(field(row, "Date of Hire")),
        assigned_to: field(row, "Assigned to", "Assigned To") || null,
        status: field(row, "Status") || "Active",
        supervisor_email: field(row, "Supervisor Email") || null,
        extension: field(row, "Extension") || null,
        notes: field(row, "Notes") || null,
      };
      const custom: Record<string, string> = {};
      for (const c of customCols) {
        const v = field(row, c.label);
        if (v) custom[c.key] = v;
      }
      if (Object.keys(custom).length) values.custom_fields = custom;

      const existing = badge ? byBadge.get(badge.trim().toLowerCase()) : undefined;
      if (existing) {
        return { id, label, change: `Update badge ${badge}`, status: "update", payload: { existingId: existing.id, values } };
      }
      const nameMatch = name ? byName.get(name.trim().toLowerCase()) : undefined;
      if (!badge && nameMatch) {
        return { id, label, change: "Update by name (no badge in file)", status: "update", payload: { existingId: nameMatch.id, values } };
      }
      if (!name) return { id, label, change: "—", status: "skip", reason: "missing name and badge" };
      if (!email) return { id, label, change: "—", status: "skip", reason: "missing email for a new staff member" };
      values.email = email.toLowerCase();
      values.role = "staff";
      values.area = me?.staff?.area ?? null;
      return { id, label, change: `Add ${name}`, status: "add", payload: { values } };
    });
  };

  const commitImport = async (items: ImportItem<UpsertPayload>[]) => {
    let failed = 0;
    for (const it of items) {
      const p = it.payload!;
      const clean = Object.fromEntries(Object.entries(p.values).filter(([, v]) => v !== undefined));
      const { error } = p.existingId
        ? await supabase.from("staff").update(clean as never).eq("id", p.existingId)
        : await supabase.from("staff").insert(clean as never);
      if (error) failed++;
    }
    if (failed) toast.error(`${failed} row(s) could not be saved`);
    await load();
  };

  if (!me?.staff) return null;
  if (!allowed) return <p>Admin / supervisor access only.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff Directory</h1>
        <p className="text-sm text-muted-foreground">Click any cell to edit. Enter saves, Escape cancels.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{filtered.length} staff</CardTitle>
          <div className="flex flex-wrap gap-2">
            <ExcelImportButton<UpsertPayload>
              title="Import staff directory"
              description="Rows are matched on BADGE; rows without a badge fall back to a name match."
              parse={parseImport}
              commit={commitImport}
            />
            <Button size="sm" variant="outline" onClick={exportDirectory}>Export to Excel</Button>
            <Button size="sm" variant="outline" onClick={addColumn}>+ Add Column</Button>
            <Button size="sm" onClick={addRow}>Add row</Button>
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
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    {columns.map((c) => (
                      <td key={c.key} className="border-b border-r p-0 align-top">
                        <EditableCell
                          value={valueOf(r, c)}
                          col={c}
                          editing={editing?.id === r.id && editing.key === c.key}
                          onStart={() => setEditing({ id: r.id, key: c.key })}
                          onCancel={() => setEditing(null)}
                          onSave={(v) => saveCell(r, c, v)}
                        />
                      </td>
                    ))}
                    <td className="border-b p-1 text-center">
                      <Button size="sm" variant="ghost" onClick={() => deleteRow(r)} aria-label={`Delete ${r.name}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="p-6 text-center text-muted-foreground">No staff match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
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