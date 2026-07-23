import { createFileRoute } from "@tanstack/react-router";

// Cron endpoint: promotes any Pending request past its auto_approve_at to Approved,
// with rule-aware guards for vacation caps and OT monthly max.
export const Route = createFileRoute("/api/public/auto-approve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret");
        const expected = process.env.CRON_SECRET;
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();
        const results: Record<string, number> = { leave: 0, change: 0, preschedule: 0, skipped: 0 };
        const skipped: { id: string; reason: string; kind: string }[] = [];

        // Load rules
        const { data: rulesRows } = await supabaseAdmin.from("system_rules").select("key,value");
        const rules = new Map((rulesRows ?? []).map((r) => [r.key as string, r.value]));
        const vacPct = Number(rules.get("vacation_cap_pct") ?? 30);
        const otMax = Number(rules.get("ot_monthly_max_hours") ?? 60);

        // --- Leave requests ---
        const { data: pendingLeaves } = await supabaseAdmin
          .from("leave_requests").select("*")
          .eq("status", "Pending").lte("auto_approve_at", now);
        for (const r of pendingLeaves ?? []) {
          if (r.leave_type === "Vacation") {
            const { count: headcount } = await supabaseAdmin
              .from("staff").select("id", { count: "exact", head: true }).eq("area", r.area);
            const cap = Math.floor(((headcount ?? 0) * vacPct) / 100);
            const { data: overlapping } = await supabaseAdmin
              .from("leave_requests").select("start_date,end_date")
              .eq("area", r.area).eq("leave_type", "Vacation").eq("status", "Approved")
              .lte("start_date", r.end_date).gte("end_date", r.start_date);
            // Count per-day approved vacations across range
            const days: string[] = [];
            const s = new Date(r.start_date + "T00:00:00");
            const e = new Date(r.end_date + "T00:00:00");
            const cur = new Date(s);
            while (cur <= e) { days.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
            let violates = false;
            for (const day of days) {
              const used = (overlapping ?? []).filter(o => o.start_date <= day && o.end_date >= day).length;
              if (used + 1 > cap) { violates = true; break; }
            }
            if (violates) {
              skipped.push({ id: r.id, kind: "leave", reason: `vacation cap ${vacPct}% exceeded` });
              continue;
            }
          }
          await supabaseAdmin.from("leave_requests").update({ status: "Approved" }).eq("id", r.id);
          // Notify requester
          if (r.staff_id) {
            await supabaseAdmin.from("notifications").insert({
              recipient_staff_id: r.staff_id,
              title: "Leave auto-approved",
              body: `${r.leave_type} ${r.start_date} → ${r.end_date}`,
              link: "/history",
            });
          }
          results.leave++;
        }

        // --- Change requests (OT-related check) ---
        const { data: pendingChanges } = await supabaseAdmin
          .from("schedule_change_requests").select("*")
          .eq("status", "Pending Supervisor").lte("auto_approve_at", now);
        for (const c of pendingChanges ?? []) {
          let violates = false;
          if (c.change_type === "give_ot" && c.target_staff_id) {
            const { data: srcShift } = await supabaseAdmin
              .from("shifts").select("date,hours").eq("id", c.source_shift_id).maybeSingle();
            if (srcShift) {
              const monthStart = srcShift.date.slice(0,7) + "-01";
              const d = new Date(monthStart + "T00:00:00");
              const monthEnd = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
              const { data: tgtShifts } = await supabaseAdmin
                .from("shifts").select("hours,is_overtime")
                .eq("staff_id", c.target_staff_id).eq("is_overtime", true)
                .gte("date", monthStart).lte("date", monthEnd);
              const currentOt = (tgtShifts ?? []).reduce((n, s) => n + Number(s.hours ?? 0), 0);
              if (currentOt + Number(srcShift.hours ?? 0) > otMax) violates = true;
            }
          }
          if (violates) {
            skipped.push({ id: c.id, kind: "change", reason: `OT monthly max ${otMax}h exceeded` });
            continue;
          }
          await supabaseAdmin.from("schedule_change_requests")
            .update({ status: "Approved", supervisor_response: "Approved" }).eq("id", c.id);
          if (c.requester_staff_id) {
            await supabaseAdmin.from("notifications").insert({
              recipient_staff_id: c.requester_staff_id,
              title: "Schedule change auto-approved",
              body: `${c.change_type}`,
              link: "/history",
            });
          }
          results.change++;
        }

        // --- Preschedule ---
        const { data: pr } = await supabaseAdmin.from("preschedule_requests")
          .update({ status: "Approved" })
          .eq("status", "Pending").lte("auto_approve_at", now).select("id");
        results.preschedule = pr?.length ?? 0;
        results.skipped = skipped.length;
        for (const s of skipped) {
          await supabaseAdmin.from("audit_logs").insert({
            action: "auto_approve_skipped", entity_type: s.kind, entity_id: s.id,
            actor_email: "system", actor_role: "system",
            details: { reason: s.reason } as never,
          });
        }

        await supabaseAdmin.from("audit_logs").insert({
          action: "auto_approve_run", entity_type: "job",
          actor_email: "system", actor_role: "system",
          details: results as never,
        });

        return new Response(JSON.stringify({ ok: true, ...results }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});