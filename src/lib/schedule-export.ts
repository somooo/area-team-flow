import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { cellFor, monthDays, toISODate, LEGEND, type RosterShift } from "@/lib/roster";
import { totalsForStaff, groupByStaff } from "@/lib/roster-totals";
import type { StaffLite } from "@/components/MonthGrid";

export type ExportInput = {
  area: string;
  year: number;
  month: number; // 0-11
  staff: StaffLite[];
  shifts: RosterShift[];
};

function buildRows({ year, month, staff, shifts }: ExportInput) {
  const days = monthDays(year, month);
  const byStaff = groupByStaff(shifts);
  const header = ["Staff", "Department", ...days.map(d => String(d.getDate())),
    "Day", "Night", "Hours", "OT h", "Sick", "Vacation"];
  const rows: (string | number)[][] = [header];
  for (const s of staff) {
    const own = byStaff.get(s.email.toLowerCase()) ?? [];
    const idx = new Map(own.map(x => [x.date, x] as const));
    const t = totalsForStaff(own);
    const dayCells = days.map(d => {
      const iso = toISODate(d);
      const shift = idx.get(iso);
      const style = cellFor(shift, d.getDay() === 0 || d.getDay() === 6);
      return style.code || "";
    });
    rows.push([s.name, s.department ?? "", ...dayCells, t.day, t.night, t.hours, t.ot_hours, t.sick, t.vacation]);
  }
  return { header, rows, days };
}

export function exportExcel(input: ExportInput) {
  const { rows } = buildRows(input);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const monthLabel = new Date(input.year, input.month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  XLSX.utils.book_append_sheet(wb, ws, `${input.area} ${monthLabel}`.slice(0, 31));
  XLSX.writeFile(wb, `schedule_${input.area}_${input.year}-${String(input.month + 1).padStart(2, "0")}.xlsx`);
}

export function exportPdf(input: ExportInput) {
  const { rows, days } = buildRows(input);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
  const monthLabel = new Date(input.year, input.month, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  doc.setFontSize(14);
  doc.text(`${input.area} — ${monthLabel}`, 30, 30);
  autoTable(doc, {
    startY: 45,
    head: [rows[0] as string[]],
    body: rows.slice(1) as (string | number)[][],
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [204, 251, 241], textColor: 20 },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 60 },
    },
  });
  // Legend
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;
  doc.setFontSize(9);
  doc.text("Legend:", 30, finalY);
  let x = 70;
  for (const l of LEGEND) {
    doc.text(`${l.sample || "·"}: ${l.label}`, x, finalY);
    x += 110;
    if (x > 1100) { x = 70; }
  }
  doc.save(`schedule_${input.area}_${input.year}-${String(input.month + 1).padStart(2, "0")}.pdf`);
  return days.length;
}