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
    supabase.from("staff").select("email,name,role,badge_id"),
  ]);
  const nameByEmail = new Map<string, string>();
  const roleByEmail = new Map<string, AppRole>();
  const badgeByEmail = new Map<string, string>();
  for (const s of (staff as { email: string; name: string; role: AppRole; badge_id: string | null }[]) ?? []) {
    nameByEmail.set(s.email.toLowerCase(), s.name);
    roleByEmail.set(s.email.toLowerCase(), s.role);
    if (s.badge_id) badgeByEmail.set(s.email.toLowerCase(), String(s.badge_id));
  }
  const header = ["Badge", "Staff Name", "Area", "Vacation Start", "Vacation End", "Days", "Status", "Requested On", "Approved By"];
  const body = ((leaves as VacationRow[]) ?? []).map((r) => [
    badgeByEmail.get(r.staff_email.toLowerCase()) ?? "",
    r.staff_name,
    r.area,
    r.start_date,
    r.end_date,
    countVacationDays(r.start_date, r.end_date, roleByEmail.get(r.staff_email.toLowerCase()) ?? "staff"),
    r.status,
    r.created_at ? r.created_at.slice(0, 10) : "",
    r.approver_email ? (nameByEmail.get(r.approver_email.toLowerCase()) ?? r.approver_email) : "",
  ]);
  downloadSheet(`vacations_${area}_${year}.xlsx`, `${area} ${year}`, [header, ...body], [12, 24, 14, 14, 14, 8, 12, 14, 22]);
  return body.length;
}

export type VacationImportPayload = {
  /** Existing leave_requests id when this row is an update. */
  existing_id?: string;
  badge: string;
  staff_id: string; staff_email: string; staff_name: string; area: string;
  start_date: string; end_date: string; status: string;
};

/**
 * Normalise a badge from either the sheet or the directory:
 * strings, numeric Excel cells, spaces/dashes and leading zeros all collapse to the same key.
 */
export function normalizeBadge(v: unknown): string {
  if (v == null) return "";
  const digits = String(v).trim().replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "");
  return stripped;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

function mapStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "Approved";
  if (s.startsWith("rej") || s.startsWith("den")) return "Rejected";
  if (s.startsWith("pen") || s.startsWith("wait")) return "Pending";
  return "Approved";
}

export type ExistingLeave = {
  id: string; staff_id: string | null; staff_email: string;
  start_date: string; end_date: string; status: string;
};

/**
 * Badge-driven vacation import planning, shared by every area.
 * Name and area always come from the staff directory; the file's name/area are never trusted.
 */
export function planVacationImport(input: {
  rows: Record<string, unknown>[];
  area: string;
  /** Skip rows whose directory area differs from `area`. */
  allAreas?: boolean;
  staff: DirectoryStaffLite[];
  existing: ExistingLeave[];
}): ImportItem<VacationImportPayload>[] {
  const { rows, area, allAreas = false, staff, existing } = input;
  const byBadge = new Map<string, DirectoryStaffLite>();
  for (const s of staff) {
    const key = normalizeBadge(s.badge_id);
    if (key) byBadge.set(key, s);
  }

  const planned: { staffId: string; start: string; end: string }[] = [];

  return rows.map((row, i) => {
    const rawBadge = field(row, "Badge", "Badge No", "Badge Number", "BadgeID", "Employee ID", "Emp ID", "ID");
    const badge = normalizeBadge(rawBadge);
    const fileName = field(row, "Staff Name", "Full Name", "Name");
    const start = toISODateValue(field(row, "Vacation Start", "Start", "Start Date", "From"));
    const end = toISODateValue(field(row, "Vacation End", "End", "End Date", "To"));
    const status = mapStatus(field(row, "Status"));
    const id = `v${i}`;
    const range = `${start ?? "?"} → ${end ?? "?"}`;
    const base = { id, badge: rawBadge.trim() || "—", label: fileName || `Row ${i + 2}`, change: range };
    const skip = (reason: string): ImportItem<VacationImportPayload> =>
      ({ ...base, status: "skip", reason });

    if (!badge) return skip("Missing badge");
    const member = byBadge.get(badge);
    if (!member) return skip(`Badge ${rawBadge.trim()} not found in staff directory`);

    const label = member.name;
    const memberArea = member.area ?? "—";
    if (!allAreas && (member.area ?? "").toLowerCase() !== area.toLowerCase()) {
      return { ...base, label, area: memberArea, status: "skip", reason: `Different area (${memberArea})` };
    }
    if (!start || !end) return { ...base, label, area: memberArea, status: "skip", reason: "Invalid dates" };
    if (end < start) return { ...base, label, area: memberArea, status: "skip", reason: "End before start" };

    const warnings: string[] = [];
    if (fileName && fileName.trim().toLowerCase() !== member.name.trim().toLowerCase()) {
      warnings.push(`File says "${fileName.trim()}", directory says "${member.name}"`);
    }

    const mine = existing.filter(
      (r) => (r.staff_id ? r.staff_id === member.id : r.staff_email.toLowerCase() === member.email.toLowerCase()),
    );
    const exact = mine.find((r) => r.start_date === start && r.end_date === end);
    const overlapping = mine.filter((r) => r !== exact && overlaps(start, end, r.start_date, r.end_date));
    if (overlapping.length > 0) {
      warnings.push(`Overlaps existing leave ${overlapping[0].start_date} → ${overlapping[0].end_date}`);
    }
    if (planned.some((p) => p.staffId === member.id && p.start === start && p.end === end)) {
      return { ...base, label, area: memberArea, status: "skip", reason: "Duplicate row in file" };
    }
    planned.push({ staffId: member.id, start, end });

    const payload: VacationImportPayload = {
      badge, staff_id: member.id, staff_email: member.email, staff_name: member.name,
      area: member.area ?? area, start_date: start, end_date: end, status,
      ...(exact ? { existing_id: exact.id } : {}),
    };

    if (exact && exact.status === status) {
      return { ...base, label, area: memberArea, status: "skip", reason: "No change (already imported)" };
    }
    return {
      ...base, label, area: memberArea,
      status: exact ? "update" : "add",
      ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
      payload,
    };
  });
}

export type VacationCommitResult = {
  written: number;
  errors: { badge: string; name: string; range: string; message: string }[];
};

/**
 * Write planned vacation rows in small batches. A failing batch is retried row by row so one
 * bad row never aborts the import; every failure is reported with its badge and Postgres message.
 */
export async function commitVacationImport(
  items: ImportItem<VacationImportPayload>[],
  opts: { approverEmail: string; setProgress?: (t: string | null) => void },
): Promise<VacationCommitResult> {
  const rows = items.map((i) => i.payload!).filter(Boolean);
  const errors: VacationCommitResult["errors"] = [];
  let written = 0;

  const describe = (p: VacationImportPayload) => ({
    badge: p.badge, name: p.staff_name, range: `${p.start_date} → ${p.end_date}`,
  });

  // Updates: status changes on an existing range.
  for (const p of rows.filter((r) => r.existing_id)) {
    const { error, data } = await supabase.from("leave_requests")
      .update({ status: p.status as "Approved" | "Pending" | "Rejected", approver_email: opts.approverEmail })
      .eq("id", p.existing_id!).select("id");
    if (error) errors.push({ ...describe(p), message: error.message });
    else if (!data || data.length === 0) errors.push({ ...describe(p), message: "Blocked by access policy (0 rows updated)" });
    else written += 1;
  }

  const inserts = rows.filter((r) => !r.existing_id);
  const CHUNK = 50;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const chunk = inserts.slice(i, i + CHUNK);
    opts.setProgress?.(`Writing ${Math.min(i + chunk.length, inserts.length)} / ${inserts.length} rows…`);
    const toRow = (p: VacationImportPayload) => ({
      staff_id: p.staff_id, staff_email: p.staff_email.toLowerCase(), staff_name: p.staff_name,
      area: p.area, leave_type: "Vacation" as const,
      start_date: p.start_date, end_date: p.end_date,
      status: p.status as "Approved" | "Pending" | "Rejected",
      approver_email: opts.approverEmail,
    });
    const { error, data } = await supabase.from("leave_requests").insert(chunk.map(toRow)).select("id");
    if (!error && data && data.length === chunk.length) { written += data.length; continue; }
    // fall back to per-row so one bad row does not lose the batch
    for (const p of chunk) {
      const { error: e, data: d } = await supabase.from("leave_requests").insert(toRow(p)).select("id");
      if (e) errors.push({ ...describe(p), message: e.message });
      else if (!d || d.length === 0) errors.push({ ...describe(p), message: "Blocked by access policy (0 rows inserted)" });
      else written += 1;
    }
  }
  opts.setProgress?.(null);
  return { written, errors };
}
