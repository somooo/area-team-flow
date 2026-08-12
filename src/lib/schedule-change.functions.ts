import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Apply an approved schedule change (reassign OT shift or swap two shifts).
// Runs as service role because switch_area may cross areas the caller can't edit directly.
export const applyScheduleChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => input)
  .handler(async ({ data, context }) => {
    // 1) Verify caller is the supervisor of the request's area (or the approver_email).
    const { data: req, error: reqErr } = await context.supabase
      .from("schedule_change_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (reqErr || !req) throw new Error("Request not found");

    const { data: me } = await context.supabase
      .from("staff")
      .select("email, role, area")
      .maybeSingle();
    const email = (me?.email ?? "").toLowerCase();
    const isAreaSupervisor =
      me?.role === "supervisor" && me?.area === req.area;
    const isApprover = (req.approver_email ?? "").toLowerCase() === email;
    if (!isAreaSupervisor && !isApprover) throw new Error("Forbidden");
    if (req.staff_response !== "Accepted") throw new Error("Target has not accepted");
    if (req.status === "Approved" || req.status === "Rejected")
      throw new Error("Already decided");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 2) Load source shift; and target shift for swaps.
    const { data: srcShift } = await supabaseAdmin
      .from("shifts").select("*").eq("id", req.source_shift_id).maybeSingle();
    if (!srcShift) throw new Error("Source shift missing");

    if (req.change_type === "give_ot") {
      const { data: tgtStaff } = await supabaseAdmin
        .from("staff").select("name,email,area")
        .eq("email", req.target_staff_email).maybeSingle();
      if (!tgtStaff) throw new Error("Target staff missing");
      await supabaseAdmin
        .from("shifts")
        .update({
          staff_email: tgtStaff.email ?? req.target_staff_email,
          staff_name: tgtStaff.name,
          area: tgtStaff.area ?? srcShift.area,
        })
        .eq("id", srcShift.id);
    } else {
      // switch_area or switch_date — swap the two shifts.
      if (!req.target_shift_id) throw new Error("Missing target shift");
      const { data: tgtShift } = await supabaseAdmin
        .from("shifts").select("*").eq("id", req.target_shift_id).maybeSingle();
      if (!tgtShift) throw new Error("Target shift missing");
      // Swap staff assignment between the two shifts.
      await supabaseAdmin.from("shifts").update({
        staff_email: tgtShift.staff_email,
        staff_name: tgtShift.staff_name,
      }).eq("id", srcShift.id);
      await supabaseAdmin.from("shifts").update({
        staff_email: srcShift.staff_email,
        staff_name: srcShift.staff_name,
      }).eq("id", tgtShift.id);
    }

    await supabaseAdmin
      .from("schedule_change_requests")
      .update({ supervisor_response: "Approved", status: "Approved" })
      .eq("id", req.id);

    return { ok: true };
  });