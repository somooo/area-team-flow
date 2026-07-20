export type Duty = "Day" | "Night" | "Off" | "Vacation" | "Sick" | "Paternity";
export type OtType = "None" | "BuiltIn" | "Additional" | "MedEvac";

export type RosterShift = {
  id: string;
  staff_email: string;
  staff_name: string;
  area: string;
  date: string;
  shift_type: string;
  hours: number;
  is_overtime: boolean;
  notes: string | null;
  unit_code: string | null;
  duty: Duty;
  ot_type: OtType;
};

export function monthDays(year: number, month: number): Date[] {
  const days: Date[] = [];
  const n = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= n; d++) days.push(new Date(year, month, d));
  return days;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type CellStyle = { code: string; className: string; title: string };

export function cellFor(shift: RosterShift | undefined, isWeekend: boolean): CellStyle {
  if (!shift) {
    return {
      code: "",
      className: isWeekend ? "bg-slate-100 text-slate-400" : "bg-white text-slate-300",
      title: "",
    };
  }
  const unit = shift.unit_code ?? "";
  const letter =
    shift.duty === "Day" ? "D" :
    shift.duty === "Night" ? "N" : "";

  // MedEvac OT overrides
  if (shift.ot_type === "MedEvac") {
    return { code: "MOT", className: "bg-amber-900 text-white", title: `MedEvac OT · ${shift.date}` };
  }
  switch (shift.duty) {
    case "Sick":
      return { code: `s${letter || "S"}${unit}`, className: "bg-red-500 text-white", title: `Sick · ${shift.date}` };
    case "Vacation":
      return { code: "VAC", className: "bg-indigo-200 text-indigo-900", title: `Vacation · ${shift.date}` };
    case "Off":
      return { code: "OFF", className: "bg-slate-300 text-slate-700", title: `Off · ${shift.date}` };
    case "Paternity":
      return { code: "P", className: "bg-emerald-500 text-white", title: `Paternity · ${shift.date}` };
    case "Day":
    case "Night": {
      if (shift.ot_type === "BuiltIn")
        return { code: `${letter}${unit}`, className: "bg-yellow-300 text-black", title: `Built-in OT · ${shift.date}` };
      if (shift.ot_type === "Additional")
        return { code: `${letter}${unit}`, className: "bg-orange-400 text-black", title: `Additional OT · ${shift.date}` };
      return { code: `${letter}${unit}`, className: "bg-white text-black border", title: `${shift.duty} duty · ${shift.date}` };
    }
  }
}

export const LEGEND: { label: string; className: string; sample: string }[] = [
  { label: "Night duty", className: "bg-white text-black border", sample: "N6" },
  { label: "Day duty", className: "bg-white text-black border", sample: "D12" },
  { label: "Built-in OT", className: "bg-yellow-300 text-black", sample: "N6" },
  { label: "Additional OT", className: "bg-orange-400 text-black", sample: "N6" },
  { label: "MedEvac OT", className: "bg-amber-900 text-white", sample: "MOT" },
  { label: "Sick leave", className: "bg-red-500 text-white", sample: "sN6" },
  { label: "Vacation", className: "bg-indigo-200 text-indigo-900", sample: "VAC" },
  { label: "Off request", className: "bg-slate-300 text-slate-700", sample: "OFF" },
  { label: "Paternity", className: "bg-emerald-500 text-white", sample: "P" },
  { label: "Weekend (empty)", className: "bg-slate-100 text-slate-400", sample: "" },
];