import { supabase } from "@/integrations/supabase/client";
import { isProtectedTest } from "@/lib/staff-import";
import { fetchCapabilityHolders } from "@/lib/capabilities";

/** Inclusive date-range overlap on ISO (YYYY-MM-DD) strings. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

export type CoverCandidate = {
  email: string;
  name: string;
  available: boolean;
  /** Why this candidate cannot cover, when unavailable. */
  reason: string | null;
};

type StaffLite = { email: string; name: string; area: string | null; role: string; status: string | null };
type LeaveLite = {
  id: string;
  staff_email: string;
  staff_name: string;
  start_date: string;
  end_date: string;
  status: string;
  covering_supervisor_email: string | null;
};

async function loadCoverData(start: string, end: string) {
  const [{ data: staff }, { data: leaves }, holders] = await Promise.all([
    supabase.from("staff").select("email,name,area,role,status,first_name"),
    supabase.from("leave_requests")
      .select("id,staff_email,staff_name,start_date,end_date,status,covering_supervisor_email")
      .in("status", ["Approved", "Pending"])
      .lte("start_date", end).gte("end_date", start),
    // Cover eligibility comes from the leave.approve capability, never job-title text.
    fetchCapabilityHolders("leave.approve"),
  ]);
  const eligible = new Set(holders.map((h) => h.email.toLowerCase()));
  return {
    staff: ((staff ?? []) as StaffLite[]).filter(
      (s) =>
        (s.status ?? "Active") === "Active" &&
        !isProtectedTest(s) &&
        eligible.has((s.email ?? "").toLowerCase()),
    ),
    leaves: (leaves ?? []) as LeaveLite[],
  };
}

/**
 * Covering-supervisor options for a range: active Supervisor-area staff, minus the
 * requester, with anyone on their own leave or already covering someone else during
 * overlapping days marked unavailable (with the reason).
 */
export async function fetchCoverCandidates(opts: {
  start: string;
  end: string;
  requesterEmail: string;
  /** Ignore this leave request when checking existing cover duties (used when editing). */
  excludeLeaveId?: string;
}): Promise<CoverCandidate[]> {
  const { start, end, requesterEmail, excludeLeaveId } = opts;
  const { staff, leaves } = await loadCoverData(start, end);
  const me = requesterEmail.toLowerCase();
  return staff
    .filter((s) => s.email.toLowerCase() !== me)
    .map((s) => {
      const email = s.email.toLowerCase();
      const own = leaves.find((l) =>
        l.staff_email.toLowerCase() === email && l.id !== excludeLeaveId &&
        rangesOverlap(start, end, l.start_date, l.end_date));
      if (own) {
        return { email: s.email, name: s.name, available: false, reason: `On ${own.status.toLowerCase()} leave ${own.start_date} → ${own.end_date}` };
      }
      const duty = leaves.find((l) =>
        (l.covering_supervisor_email ?? "").toLowerCase() === email && l.id !== excludeLeaveId &&
        rangesOverlap(start, end, l.start_date, l.end_date));
      if (duty) {
        return { email: s.email, name: s.name, available: false, reason: `Already covering ${duty.staff_name} ${duty.start_date} → ${duty.end_date}` };
      }
      return { email: s.email, name: s.name, available: true, reason: null };
    })
    .sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name));
}

export type CoverConflict = { leaveId: string; coverName: string; reason: string };

/**
 * Re-checks the nominated cover for each request: flags a conflict when the cover has
 * since gone on leave, left the Supervisor area, or picked up overlapping cover duty.
 */
export async function detectCoverConflicts(
  requests: { id: string; staff_email: string; start_date: string; end_date: string; covering_supervisor_email: string | null }[],
): Promise<Record<string, CoverConflict>> {
  const withCover = requests.filter((r) => r.covering_supervisor_email);
  if (withCover.length === 0) return {};
  const start = withCover.map((r) => r.start_date).sort()[0]!;
  const end = withCover.map((r) => r.end_date).sort().at(-1)!;
  const { staff, leaves } = await loadCoverData(start, end);
  const byEmail = new Map(staff.map((s) => [s.email.toLowerCase(), s]));
  const out: Record<string, CoverConflict> = {};
  for (const r of withCover) {
    const email = r.covering_supervisor_email!.toLowerCase();
    const s = byEmail.get(email);
    const name = s?.name ?? r.covering_supervisor_email!;
    if (!s) { out[r.id] = { leaveId: r.id, coverName: name, reason: "No longer an active supervisor" }; continue; }
    const own = leaves.find((l) =>
      l.staff_email.toLowerCase() === email && rangesOverlap(r.start_date, r.end_date, l.start_date, l.end_date));
    if (own) { out[r.id] = { leaveId: r.id, coverName: name, reason: `On ${own.status.toLowerCase()} leave ${own.start_date} → ${own.end_date}` }; continue; }
    const duty = leaves.find((l) =>
      l.id !== r.id && (l.covering_supervisor_email ?? "").toLowerCase() === email &&
      rangesOverlap(r.start_date, r.end_date, l.start_date, l.end_date));
    if (duty) out[r.id] = { leaveId: r.id, coverName: name, reason: `Also covering ${duty.staff_name} ${duty.start_date} → ${duty.end_date}` };
  }
  return out;
}
