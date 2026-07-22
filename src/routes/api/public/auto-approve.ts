import { createFileRoute } from "@tanstack/react-router";

// Cron endpoint: promotes any Pending request past its auto_approve_at to Approved.
export const Route = createFileRoute("/api/public/auto-approve")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date().toISOString();
        const results: Record<string, number> = { leave: 0, change: 0, preschedule: 0 };

        const { data: lv } = await supabaseAdmin.from("leave_requests")
          .update({ status: "Approved" })
          .eq("status", "Pending").lte("auto_approve_at", now).select("id");
        results.leave = lv?.length ?? 0;

        const { data: ch } = await supabaseAdmin.from("schedule_change_requests")
          .update({ status: "Approved", supervisor_response: "Approved" })
          .eq("status", "Pending Supervisor").lte("auto_approve_at", now).select("id");
        results.change = ch?.length ?? 0;

        const { data: pr } = await supabaseAdmin.from("preschedule_requests")
          .update({ status: "Approved" })
          .eq("status", "Pending").lte("auto_approve_at", now).select("id");
        results.preschedule = pr?.length ?? 0;

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