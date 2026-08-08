import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { cellFor, monthDays, toISODate, isWeekendDay, LEGEND, type RosterShift } from "@/lib/roster";
import { totalsForStaff, groupByStaff, type TotalsOptions } from "@/lib/roster-totals";
import type { StaffLite } from "@/components/MonthGrid";
import type { ZoneReferenceRow } from "@/lib/assignments";

export type ExportInput = {
  area: string;
  year: number;
  month: number; // 0-11
  staff: StaffLite[];
  shifts: RosterShift[];
  layer?: "all" | "day" | "night";
  /** Supervisor/admin exports add an OT Summary sheet. */
  withSummary?: boolean;
};

/* ------------------------------------------------------------------ */
/* Cell model: visible base code + underlying tagged value + fill      */
/* ------------------------------------------------------------------ */

const FILL = {
  bot: "FFF2C94C",
  aot: "FFE88B2A",
  mot: "FFB98F52",
  vac: "FFA2ABD8",
  off: "FFD3D5D7",
  sick: "FFEF4444",
  pat: "FF10B981",
  weekend: "FFF1F5F9",
} as const;

export type ExportCell = { display: string; raw: string; fill?: string; light?: boolean };

export function exportCell(shift: RosterShift | undefined, isWeekend: boolean): ExportCell {
  if (!shift) return { display: "", raw: "", fill: isWeekend ? FILL.weekend : undefined };
  const unit = shift.unit_code ?? "";
  const letter = shift.duty === "Day" ? "D" : shift.duty === "Night" ? "N" : "";
  const base = `${letter}${unit}`;

  // MedEvac is always a standalone MOT entry: no ward code, never sick.
  if (shift.ot_type === "MedEvac" && (shift.duty === "Day" || shift.duty === "Night")) {
    return { display: "MOT", raw: "MOT", fill: FILL.mot, light: true };
  }

  if (shift.sick_tag) {
    const b = base || "S";
    return { display: b, raw: `s${b}`, fill: FILL.sick, light: true };
  }
  switch (shift.duty) {
    case "Sick": {
      const b = base || "S";
      return { display: b, raw: `s${b}`, fill: FILL.sick, light: true };
    }
    case "Vacation":
      return { display: "V", raw: "V", fill: FILL.vac };
    case "Off":
      return { display: "OFF", raw: "OFF", fill: FILL.off };
    case "Paternity":
      return { display: "P", raw: "P", fill: FILL.pat, light: true };
    default: {
      if (shift.ot_type === "BuiltIn") return { display: base, raw: `${base}|BOT`, fill: FILL.bot };
      if (shift.ot_type === "Additional") return { display: base, raw: `${base}|AOT`, fill: FILL.aot };
      return { display: base, raw: base, fill: isWeekend ? FILL.weekend : undefined };
    }
  }
}

/** Excel number format that shows only the base code while the cell value keeps the tag. */
function maskFormat(display: string): string {
  return `General;General;General;"${display.replace(/"/g, "")}"`;
}

/* ------------------------------------------------------------------ */

async function loadExtras(area: string, emails: string[], year: number, month: number) {
  const [{ data: ref }, { data: st }, { data: rules }, { data: ovr }] = await Promise.all([
    supabase.from("zone_reference").select("*").eq("area", area).order("sort_order"),
    supabase.from("staff").select("id,email,badge_id,area,shift_base_override").in("email", emails.length ? emails : ["__none__"]),
    supabase.from("system_rules").select("key,value"),
    supabase.from("regular_shift_overrides").select("staff_id,regular_shifts").eq("area", area).eq("year", year).eq("month", month),
  ]);
  const badges = new Map<string, string>();
  const profile = new Map<string, { id: string; area: string | null; base: number | null }>();
  type StaffRow = { id: string; email: string; badge_id: string | null; area: string | null; shift_base_override: number | null };
  for (const s of (st as StaffRow[]) ?? []) {
    if (s.badge_id) badges.set(s.email.toLowerCase(), s.badge_id);
    profile.set(s.email.toLowerCase(), { id: s.id, area: s.area, base: s.shift_base_override });
  }
  const overrides = new Map<string, number>();
  for (const o of ((ovr as { staff_id: string; regular_shifts: number }[]) ?? [])) overrides.set(o.staff_id, o.regular_shifts);
  const ruleMap = new Map<string, unknown>();
  for (const r of (rules as { key: string; value: unknown }[]) ?? []) ruleMap.set(r.key, r.value);
  return { ref: ((ref as ZoneReferenceRow[]) ?? []), badges, ruleMap, profile, overrides };
}

type UnitGroup = { zone: string; unit: string; assignments: string[]; extension: string };

function groupReference(ref: ZoneReferenceRow[]): UnitGroup[] {
  const out: UnitGroup[] = [];
  for (const r of ref) {
    const zone = r.zone ?? "";
    const unit = r.unit ?? r.label ?? "";
    let g = out.find((x) => x.zone === zone && x.unit === unit);
    if (!g) { g = { zone, unit, assignments: [], extension: "" }; out.push(g); }
    const no = r.assignment_no ?? "";
    if (no) g.assignments.push(r.pager ? `${no} (${r.pager})` : no);
    if (r.extension && !g.extension) g.extension = r.extension;
  }
  return out;
}

const THIN = { style: "thin" as const, color: { argb: "FFB8C0C8" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

export async function exportExcel(input: ExportInput) {
  const { area, year, month, staff, shifts, withSummary } = input;
  const layer = input.layer ?? "all";
  const days = monthDays(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  const { ref, badges, ruleMap, profile, overrides } = await loadExtras(area, staff.map((s) => s.email), year, month);
  const totalsOptionsFor = (email: string): TotalsOptions => {
    const p = profile.get(email.toLowerCase());
    return {
      daysInMonth: days.length,
      sickOtExcludedFromDuty: ruleMap.get("sick_ot_excluded_from_duty") === true,
      baseOverride: p?.base ?? null,
      staffArea: p?.area ?? null,
      scheduleArea: area,
      regularShiftsOverride: p ? overrides.get(p.id) ?? null : null,
      benefitDaysMinHolidays: Number(ruleMap.get("benefit_days_min_holidays") ?? 5),
    };
  };

  const wb = new ExcelJS.Workbook();
  // The importer looks for a sheet named "Schedule"; the pretty label lives in the title row.
  const ws = wb.addWorksheet("Schedule", { views: [{ state: "frozen", xSplit: 2, ySplit: 0 }] });
  ws.properties.defaultRowHeight = 16;
  const lastCol = 2 + days.length;

  const layerLabel = layer === "all" ? "" : layer === "day" ? " (Day)" : " (Night)";

  // 1. Header block
  const title = ws.addRow([`${area} Schedule - ${monthLabel}${layerLabel}`]);
  ws.mergeCells(title.number, 1, title.number, lastCol);
  title.getCell(1).font = { name: "Arial", bold: true, size: 14 };
  title.getCell(1).alignment = { horizontal: "center" };

  const hijri = (() => {
    try {
      return new Intl.DateTimeFormat("en-u-ca-islamic", { month: "long", year: "numeric" })
        .format(new Date(year, month, 15));
    } catch { return ""; }
  })();
  if (hijri) {
    const sub = ws.addRow([hijri]);
    ws.mergeCells(sub.number, 1, sub.number, lastCol);
    sub.getCell(1).font = { name: "Arial", italic: true, size: 10 };
    sub.getCell(1).alignment = { horizontal: "center" };
  }

  const deadlineDay = Number(ruleMap.get("preschedule_open_day") ?? 10);
  const note = ws.addRow([`Deadline for requests is the ${deadlineDay}th of every month`]);
  ws.mergeCells(note.number, 1, note.number, lastCol);
  note.getCell(1).font = { name: "Arial", size: 10, color: { argb: "FFB45309" } };
  note.getCell(1).alignment = { horizontal: "center" };
  ws.addRow([]);

  // 2. Zone / Unit / Assignment (Pager) / Extension block
  const groups = groupReference(ref);
  if (groups.length) {
    const startCol = 3;
    const zoneRow = ws.addRow([]);
    zoneRow.getCell(1).value = "ZONE";
    const unitRow = ws.addRow([]);
    unitRow.getCell(1).value = "UNIT";
    const asgRow = ws.addRow([]);
    asgRow.getCell(1).value = "ASSIGNMENT (PAGER)";
    const extRow = ws.addRow([]);
    extRow.getCell(1).value = "EXTENSION";
    for (const r of [zoneRow, unitRow, asgRow, extRow]) {
      ws.mergeCells(r.number, 1, r.number, 2);
      r.getCell(1).font = { name: "Arial", bold: true, size: 9 };
      r.getCell(1).alignment = { vertical: "middle", wrapText: true };
      r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      r.getCell(1).border = BORDER;
    }
    groups.forEach((g, i) => {
      const col = startCol + i;
      const set = (row: ExcelJS.Row, v: string) => {
        const c = row.getCell(col);
        c.value = v;
        c.font = { name: "Arial", size: 8 };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = BORDER;
      };
      set(zoneRow, g.zone);
      set(unitRow, g.unit);
      set(asgRow, g.assignments.join("\n"));
      set(extRow, g.extension);
      zoneRow.getCell(col).font = { name: "Arial", size: 9, bold: true };
      zoneRow.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCBD5E1" } };
      unitRow.getCell(col).font = { name: "Arial", size: 9, bold: true };
      unitRow.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    });
    // merge zone header across consecutive units of the same zone
    let i = 0;
    while (i < groups.length) {
      let j = i;
      while (j + 1 < groups.length && groups[j + 1].zone === groups[i].zone) j++;
      if (j > i) ws.mergeCells(zoneRow.number, startCol + i, zoneRow.number, startCol + j);
      i = j + 1;
    }
    asgRow.height = Math.min(90, 14 * Math.max(1, ...groups.map((g) => g.assignments.length || 1)));
    ws.addRow([]);
  }

  // 3. Staff schedule grid
  // Real Date values so a re-import reads the month with "certain" confidence; numFmt keeps them showing as 1, 2, 3…
  const headRow = ws.addRow(["Staff Name", "Badge", ...days]);
  headRow.eachCell((c, n) => {
    c.font = { name: "Arial", bold: true, size: 9 };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = BORDER;
    if (n > 2) c.numFmt = "d";
    const wknd = n > 2 && isWeekendDay(days[n - 3], layer);
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: wknd ? "FFCBD5E1" : "FFE2E8F0" } };
  });
  const wdRow = ws.addRow(["", "", ...days.map((d) => d.toLocaleDateString(undefined, { weekday: "short" }))]);
  wdRow.eachCell((c) => {
    c.font = { name: "Arial", size: 8, color: { argb: "FF64748B" } };
    c.alignment = { horizontal: "center" };
    c.border = BORDER;
  });
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: wdRow.number }];

  const byStaff = groupByStaff(shifts);
  const zones = new Map<string, StaffLite[]>();
  for (const s of staff) {
    const k = s.department || "—";
    if (!zones.has(k)) zones.set(k, []);
    zones.get(k)!.push(s);
  }
  for (const [zone, members] of Array.from(zones.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const zr = ws.addRow([zone]);
    ws.mergeCells(zr.number, 1, zr.number, lastCol);
    zr.getCell(1).font = { name: "Arial", bold: true, size: 9 };
    zr.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCBD5E1" } };
    zr.getCell(1).border = BORDER;

    for (const s of members) {
      const own = byStaff.get(s.email.toLowerCase()) ?? [];
      const idx = new Map(own.map((x) => [x.date, x] as const));
      const row = ws.addRow([s.name, badges.get(s.email.toLowerCase()) ?? ""]);
      row.getCell(1).font = { name: "Arial", size: 9 };
      row.getCell(2).font = { name: "Arial", size: 9 };
      row.getCell(1).border = BORDER;
      row.getCell(2).border = BORDER;
      row.getCell(2).alignment = { horizontal: "center" };
      days.forEach((d, di) => {
        const cell = row.getCell(3 + di);
        const model = exportCell(idx.get(toISODate(d)), isWeekendDay(d, layer));
        cell.value = model.raw || null;
        if (model.raw && model.raw !== model.display) cell.numFmt = maskFormat(model.display);
        cell.font = { name: "Arial", size: 9, bold: !!model.fill && model.fill !== FILL.weekend, color: { argb: model.light ? "FFFFFFFF" : "FF111827" } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = BORDER;
        if (model.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: model.fill } };
      });
    }
  }

  // Legend
  ws.addRow([]);
  const lg = ws.addRow(["Legend"]);
  lg.getCell(1).font = { name: "Arial", bold: true, size: 9 };
  const legendRow = ws.addRow([]);
  LEGEND.forEach((l, i) => {
    const c = legendRow.getCell(1 + i * 2);
    c.value = l.label;
    c.font = { name: "Arial", size: 8 };
    const hex = l.className.match(/#([0-9A-Fa-f]{6})/)?.[1];
    if (hex) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` } };
  });

  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 10;
  for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 5.5;

  // Optional supervisor summary sheet
  if (withSummary) {
    const sum = wb.addWorksheet("OT Summary");
    const head = sum.addRow(["Staff", "Badge", "Department", "Day", "Night", "Hours", "OT hours", "Sick", "Vacation"]);
    head.eachCell((c) => {
      c.font = { name: "Arial", bold: true, size: 10 };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      c.border = BORDER;
    });
    for (const s of staff) {
      const t = totalsForStaff(byStaff.get(s.email.toLowerCase()) ?? []);
      const r = sum.addRow([s.name, badges.get(s.email.toLowerCase()) ?? "", s.department ?? "", t.day, t.night, t.hours, t.ot_hours, t.sick, t.vacation]);
      r.eachCell((c) => { c.font = { name: "Arial", size: 10 }; c.border = BORDER; });
    }
    sum.getColumn(1).width = 24;
    sum.getColumn(3).width = 18;
    for (let c = 4; c <= 9; c++) sum.getColumn(c).width = 10;
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `schedule_${area}_${year}-${String(month + 1).padStart(2, "0")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------- PDF ------------------------------- */

export function exportPdf(input: ExportInput) {
  const { year, month, staff, shifts } = input;
  const days = monthDays(year, month);
  const byStaff = groupByStaff(shifts);
  const header = ["Staff", "Department", ...days.map((d) => String(d.getDate())),
    "Day", "Night", "Hours", "OT h", "Sick", "Vacation"];
  const body: (string | number)[][] = staff.map((s) => {
    const own = byStaff.get(s.email.toLowerCase()) ?? [];
    const idx = new Map(own.map((x) => [x.date, x] as const));
    const t = totalsForStaff(own);
    const cells = days.map((d) => cellFor(idx.get(toISODate(d)), isWeekendDay(d, input.layer ?? "all")).code || "");
    return [s.name, s.department ?? "", ...cells, t.day, t.night, t.hours, t.ot_hours, t.sick, t.vacation];
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
  const monthLabel = new Date(year, month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  doc.setFontSize(14);
  doc.text(`${input.area} — ${monthLabel}`, 30, 30);
  autoTable(doc, {
    startY: 45,
    head: [header],
    body,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [204, 213, 225], textColor: 20 },
    columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 60 } },
  });
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;
  doc.setFontSize(9);
  doc.text("Legend:", 30, finalY);
  let x = 70;
  for (const l of LEGEND) { doc.text(l.label, x, finalY); x += 110; if (x > 1100) x = 70; }
  doc.save(`schedule_${input.area}_${input.year}-${String(input.month + 1).padStart(2, "0")}.pdf`);
  return days.length;
}
