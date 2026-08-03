import { supabase } from "@/integrations/supabase/client";
import type { ImportItem } from "@/components/ExcelImportButton";
import { downloadSheet, field, toISODateValue } from "@/lib/xlsx-io";
import { countVacationDays } from "@/lib/hours-model";
import type { AppRole } from "@/lib/permissions";

export type VacationRow = {
  id: string;
  staff_email: string;
  staff_name: string;
  area: string;
  start_date: string;
  end_date: string;
  status: string;
  approver_email: string | null;
  created_at: string;
};

export type DirectoryStaffLite = {
  id: string; email: string; name: string; role: AppRole; area: string | null; badge_id?: string | null;
};

/** Export the selected area's vacation rows for one calendar year. */
export async function exportVacationsExcel(area: string, year: number) {
  const [{ data: leaves }, { data: staff }] = await Promise.all([
    supabase.from("leave_requests")
      .select("id,staff_email,staff_name,area,start_date,end_date,status,approver_email,created_at")
      .eq("area", area).eq("leave_type", "Vacation")
      .lte("start_date", `${year}-12-31`).gte("end_date", `${year}-01-01`)
      .order("start_date"),
    supabase.from("staff").select("email,name,role"),
  ]);
  const nameByEmail = new Map<string, string>();
  const roleByEmail = new Map<string, AppRole>();
  for (const s of (staff as { email: string; name: string; role: AppRole }[]) ?? []) {
    nameByEmail.set(s.email.toLowerCase(), s.name);
    roleByEmail.set(s.email.toLowerCase(), s.role);
  }
  const header = ["Staff Name", "Area", "Vacation Start", "Vacation End", "Days", "Status", "Requested On", "Approved By"];
  const body = ((leaves as VacationRow[]) ?? []).map((r) => [
    r.staff_name,
    r.area,
    r.start_date,
    r.end_date,
    countVacationDays(r.start_date, r.end_date, roleByEmail.get(r.staff_email.toLowerCase()) ?? "staff"),
    r.status,
    r.created_at ? r.created_at.slice(0, 10) : "",
    r.approver_email ? (nameByEmail.get(r.approver_email.toLowerCase()) ?? r.approver_email) : "",
  ]);
  downloadSheet(`vacations_${area}_${year}.xlsx`, `${area} ${year}`, [header, ...body], [24, 14, 14, 14, 8, 12, 14, 22]);
  return body.length;
}

export type VacationImportPayload = {
  staff_id: string; staff_email: string; staff_name: string; area: string;
  start_date: string; end_date: string; status: string;
};

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Validate imported vacation rows against the same rules as a manual leave request. */
export function planVacationImport(input: {
  rows: Record<string, unknown>[];
  area: string;
  staff: DirectoryStaffLite[];
  existing: { staff_email: string; start_date: string; end_date: string; status: string }[];
  yearlyCap: number;
}): ImportItem<VacationImportPayload>[] {
  const { rows, area, staff, existing, yearlyCap } = input;
  const byName = new Map(staff.map((s) => [s.name.trim().toLowerCase(), s]));
  const byBadge = new Map(staff.filter((s) => s.badge_id).map((s) => [String(s.badge_id).trim().toLowerCase(), s]));

  // running usage per staff so a batch can't blow past the yearly cap
  const used = new Map<string, number>();
  for (const r of existing) {
    if (r.status !== "Approved" && r.status !== "Pending") continue;
    const key = r.staff_email.toLowerCase();
    const member = staff.find((s) => s.email.toLowerCase() === key);
    used.set(key, (used.get(key) ?? 0) + countVacationDays(r.start_date, r.end_date, member?.role ?? "staff"));
  }
  const planned: { email: string; start: string; end: string }[] = [];

  return rows.map((row, i) => {
    const name = field(row, "Staff Name", "Full Name", "Name");
    const badge = field(row, "Badge", "BADGE", "Badge Number");
    const rowArea = field(row, "Area");
    const start = toISODateValue(field(row, "Vacation Start", "Start", "Start Date"));
    const end = toISODateValue(field(row, "Vacation End", "End", "End Date"));
    const statusRaw = field(row, "Status") || "Approved";
    const status = /reject/i.test(statusRaw) ? "Rejected" : /pend/i.test(statusRaw) ? "Pending" : "Approved";
    const id = `v${i}`;
    const label = name || badge || `Row ${i + 2}`;
    const change = `${start ?? "?"} → ${end ?? "?"} · ${status}`;
    const skip = (reason: string): ImportItem<VacationImportPayload> => ({ id, label, change, status: "skip", reason });

    const member = byName.get(name.trim().toLowerCase()) ?? (badge ? byBadge.get(badge.trim().toLowerCase()) : undefined);
    if (!member) return skip("unmatched name");
    if (rowArea && rowArea.trim().toLowerCase() !== area.toLowerCase()) return skip(`not in ${area}`);
    if ((member.area ?? "").toLowerCase() !== area.toLowerCase()) return skip(`not in ${area}`);
    if (!start || !end || end < start) return skip("invalid dates");

    const key = member.email.toLowerCase();
    const clash =
      existing.some((r) => (r.status === "Approved" || r.status === "Pending")
        && r.staff_email.toLowerCase() === key && overlaps(start, end, r.start_date, r.end_date)) ||
      planned.some((p) => p.email === key && overlaps(start, end, p.start, p.end));
    if (clash) return skip("overlapping existing leave");

    const days = countVacationDays(start, end, member.role);
    const total = (used.get(key) ?? 0) + days;
    if (yearlyCap > 0 && total > yearlyCap) return skip("exceeds yearly cap");

    used.set(key, total);
    planned.push({ email: key, start, end });
    return {
      id, label, change, status: "add",
      payload: {
        staff_id: member.id, staff_email: member.email, staff_name: member.name,
        area, start_date: start, end_date: end, status,
      },
    };
  });
}