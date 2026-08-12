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
  sick_tag?: boolean | null;
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
  // Codes render exactly as stored; night keeps the source's lowercase "s" prefix.
  const unit = shift.unit_code ?? "";
  const base = shift.duty === "Night" && unit ? `s${unit}` : unit;

  // MedEvac OT is a standalone entry and can never be sick — checked before the sick tag.
  if (shift.ot_type === "MedEvac") {
    return { code: "MOT", className: "bg-[#B98F52] text-white", title: `MedEvac OT · ${shift.date}` };
  }

  // Sick tag layers on top of the original assignment: keep the code, colour it red.
  if (shift.sick_tag) {
    const b = base || "S";
    return {
      code: b,
      className: "bg-red-500 text-white",
      title: `Sick leave (assigned ${b}) · ${shift.date}`,
    };
  }

  switch (shift.duty) {
    case "Sick":
      return { code: base || "S", className: "bg-red-500 text-white", title: `Sick · ${shift.date}` };
    case "Vacation":
      return { code: "V", className: "bg-[#A2ABD8] text-slate-900", title: `Vacation · ${shift.date}` };
    case "Off":
      return { code: "OFF", className: "bg-[#D3D5D7] text-slate-700", title: `Off · ${shift.date}` };
    case "Paternity":
      return { code: "P", className: "bg-emerald-500 text-white", title: `Paternity · ${shift.date}` };
    case "Day":
    case "Night": {
      if (shift.ot_type === "BuiltIn")
        return { code: base, className: "bg-[#F2C94C] text-black", title: `Built-in OT · ${shift.date}` };
      if (shift.ot_type === "Additional")
        return { code: base, className: "bg-[#E88B2A] text-black", title: `Additional OT · ${shift.date}` };
      return { code: base, className: "bg-white text-black border", title: `${shift.duty} duty · ${shift.date}` };
    }
  }
}

export const LEGEND: { label: string; className: string }[] = [
  { label: "Built-in Overtime", className: "bg-[#F2C94C]" },
  { label: "Additional Overtime", className: "bg-[#E88B2A]" },
  { label: "Medivac Overtime", className: "bg-[#B98F52]" },
  { label: "Vacation", className: "bg-[#A2ABD8]" },
  { label: "Off", className: "bg-[#D3D5D7]" },
];

/** Static weekend rule: night schedules run Thu+Fri, everything else Fri+Sat. */
export function isWeekendDay(d: Date, layer: "all" | "day" | "night"): boolean {
  const wd = d.getDay();
  return layer === "night" ? wd === 4 || wd === 5 : wd === 5 || wd === 6;
}