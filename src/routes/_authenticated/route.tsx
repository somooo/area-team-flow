import { createFileRoute, Outlet, Link, useNavigate, useRouterState, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { HeartPulse, LogOut } from "lucide-react";
import { useMe } from "@/lib/use-me";
import { NotificationsBell } from "@/components/NotificationsBell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { userEmail: data.user.email };
  },
  component: Shell,
});

function Shell() {
  const { me, loading } = useMe();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") navigate({ to: "/auth" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const signOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (me && !me.staff) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <HeartPulse className="h-10 w-10 mx-auto text-primary" />
          <h1 className="text-2xl font-semibold">No access yet</h1>
          <p className="text-muted-foreground">
            Your Google account <strong>{me.authEmail}</strong> isn't on the staff roster.
            Please ask your area supervisor to add you.
          </p>
          <Button variant="outline" onClick={signOut} disabled={signingOut}>Sign out</Button>
        </div>
      </div>
    );
  }

  const role = me?.staff?.role as string | undefined;
  const links: { to: string; label: string; show: boolean }[] = [
    { to: "/dashboard", label: "Schedule", show: role === "staff" || role === "supervisor" || role === "team_leader" },
    { to: "/vacations", label: "Vacations", show: role === "staff" || role === "supervisor" || role === "team_leader" },
    { to: "/preschedule", label: "Pre-schedule", show: role === "staff" || role === "supervisor" || role === "team_leader" },
    { to: "/supervisor", label: "Supervisor", show: role === "supervisor" || role === "team_leader" },
    { to: "/approvals", label: "Approvals", show: role === "supervisor" || role === "team_leader" || role === "admin" },
    { to: "/reports", label: "Reports", show: role === "admin" || role === "supervisor" },
    { to: "/settings", label: "Settings", show: role === "admin" },
    { to: "/audit", label: "Audit", show: role === "admin" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-primary" />
            <span className="font-semibold">Shift & Leave</span>
          </div>
          <nav className="flex items-center gap-1 flex-wrap">
            {links.filter(l => l.show).map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  pathname === l.to
                    ? "bg-teal-600 text-white font-medium shadow-sm"
                    : "text-slate-600 hover:bg-teal-50 hover:text-teal-700"
                }`}
              >{l.label}</Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right hidden sm:block">
              <div className="font-medium">{me?.staff?.name}</div>
              <div className="text-muted-foreground text-xs">
                {me?.staff?.role}{me?.staff?.area ? ` · ${me.staff.area}` : ""}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} disabled={signingOut}>
              <LogOut className="h-4 w-4" />
            </Button>
            <NotificationsBell />
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}