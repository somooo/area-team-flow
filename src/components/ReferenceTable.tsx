import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ZoneReferenceRow } from "@/lib/assignments";

type Props = { area: string; rows: ZoneReferenceRow[] };

/** Dense zone / assignment / pager reference shown above the schedule. */
export function ReferenceTable({ area, rows }: Props) {
  const [open, setOpen] = useState(false);
  const kind = area.toLowerCase();

  const columns = useMemo<{ key: keyof ZoneReferenceRow; label: string }[]>(() => {
    if (kind === "wards")
      return [
        { key: "zone", label: "Zone" },
        { key: "assignment_no", label: "ID" },
        { key: "pager", label: "Pager" },
        { key: "unit", label: "Unit(s)" },
        { key: "role", label: "Role" },
      ];
    if (kind === "assistants")
      return [
        { key: "assignment_no", label: "Code" },
        { key: "pager", label: "Pager" },
        { key: "coverage_weekday", label: "Weekday coverage" },
        { key: "coverage_weekend", label: "Weekend coverage" },
      ];
    return [
      { key: "zone", label: "Zone" },
      { key: "unit", label: "Unit" },
      { key: "assignment_no", label: "Assignment No." },
      { key: "label", label: "Label" },
      { key: "pager", label: "Pager" },
      { key: "extension", label: "Extension" },
    ];
  }, [kind]);

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-steel-800"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {area} assignments &amp; pagers
      </button>
      {open && (
        <div className="max-h-64 overflow-auto border-t">
          <table className="w-full border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={String(c.key)}
                    className="sticky top-0 z-10 border-b border-r bg-steel-100 px-2 py-1 text-left font-medium uppercase tracking-wider text-steel-800"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="even:bg-muted/30">
                  {columns.map((c) => (
                    <td key={String(c.key)} className="border-b border-r px-2 py-[3px] leading-tight align-top">
                      {(r[c.key] as string) || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
