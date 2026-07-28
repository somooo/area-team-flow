import { Fragment, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cellFor, monthDays, toISODate, LEGEND, type RosterShift } from "@/lib/roster";
import { cn } from "@/lib/utils";

export type StaffLite = {
  id: string;
  name: string;
  email: string;
  role: string;
  area: string | null;
  department: string | null;
};

export type MonthGridProps = {
  year: number;
  month: number; // 0-11
  onMonthChange: (year: number, month: number) => void;
  staff: StaffLite[];
  shifts: RosterShift[];
  meEmail: string;
  areaLabel?: string;
  headerRight?: ReactNode;
  onCellClick?: (row: { staff: StaffLite; date: string; shift?: RosterShift }) => void;
  layer?: "all" | "day" | "night";
};

export function MonthGrid({ year, month, onMonthChange, staff, shifts, meEmail, areaLabel, headerRight, onCellClick, layer = "all" }: MonthGridProps) {
  const days = useMemo(() => monthDays(year, month), [year, month]);
  const monthLabel = new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });

  const grouped = useMemo(() => {
    const map = new Map<string, StaffLite[]>();
    for (const s of staff) {
      const k = s.department || "—";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [staff]);

  const shiftIdx = useMemo(() => {
    const map = new Map<string, RosterShift>();
    const filtered = layer === "all"
      ? shifts
      : shifts.filter(s => {
          if (layer === "day") return s.duty !== "Night";
          return s.duty === "Night";
        });
    for (const s of filtered) map.set(`${s.staff_email.toLowerCase()}|${s.date}`, s);
    return map;
  }, [shifts, layer]);

  const prev = () => {
    const d = new Date(year, month - 1, 1);
    onMonthChange(d.getFullYear(), d.getMonth());
  };
  const next = () => {
    const d = new Date(year, month + 1, 1);
    onMonthChange(d.getFullYear(), d.getMonth());
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prev} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="font-display text-lg sm:text-xl uppercase tracking-[0.12em] flex-1 min-w-0 sm:min-w-40 text-center truncate">{monthLabel}</h2>
          <Button variant="outline" size="icon" onClick={next} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerRight}
          {!headerRight && areaLabel && <div className="text-sm text-muted-foreground">Area: {areaLabel}</div>}
        </div>
      </div>

      <div className="border rounded-md overflow-auto max-h-[70vh] relative bg-card">
        <table className="text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-steel-100 border-b border-r px-3 py-2 text-left min-w-[180px] uppercase tracking-wider text-[11px] text-steel-800">Staff</th>
              {days.map((d) => {
                const wd = d.toLocaleDateString(undefined, { weekday: "short" });
                const isWknd = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <th
                    key={d.toISOString()}
                    className={cn(
                      "sticky top-0 z-20 border-b border-r px-1 py-1 text-center font-medium",
                      isWknd ? "bg-muted" : "bg-steel-100"
                    )}
                  >
                    <div className="leading-tight">{d.getDate()}</div>
                    <div className="text-[10px] font-normal text-muted-foreground">{wd}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([dept, members]) => (
              <Fragment key={`dept-${dept}`}>
                <tr>
                  <td colSpan={days.length + 1} className="bg-steel-200/70 text-steel-900 text-[11px] font-semibold uppercase tracking-[0.16em] px-3 py-1 sticky left-0 z-10">
                    {dept}
                  </td>
                </tr>
                {members.map((s) => {
                  const isMe = s.email.toLowerCase() === meEmail.toLowerCase();
                  return (
                    <tr key={s.id} className={cn(isMe && "bg-steel-100/40")}>
                      <td className={cn("sticky left-0 z-10 border-b border-r px-3 py-2 min-w-[180px]", isMe ? "bg-steel-100" : "bg-card")}>
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {s.role}{s.department ? ` · ${s.department}` : ""}
                        </div>
                      </td>
                      {days.map((d) => {
                        const iso = toISODate(d);
                        const shift = shiftIdx.get(`${s.email.toLowerCase()}|${iso}`);
                        const isWknd = d.getDay() === 0 || d.getDay() === 6;
                        const style = cellFor(shift, isWknd);
                        const clickable = !!onCellClick;
                        return (
                          <td
                            key={iso}
                            title={style.title}
                            onClick={clickable ? () => onCellClick!({ staff: s, date: iso, shift }) : undefined}
                            className={cn(
                              "border-b border-r text-center align-middle p-0",
                              style.className,
                              clickable && "cursor-pointer hover:ring-2 hover:ring-steel-400"
                            )}
                          >
                            <div className="w-10 h-10 flex items-center justify-center text-[11px] font-semibold">
                              {style.code}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border p-3 bg-secondary/60">
        <div className="text-xs font-semibold mb-2 uppercase tracking-[0.16em] text-steel-800">Legend</div>
        <div className="flex flex-wrap gap-3">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-2">
              <span className={cn("inline-flex items-center justify-center w-8 h-6 rounded text-[10px] font-semibold", l.className)}>
                {l.sample}
              </span>
              <span className="text-xs">{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}