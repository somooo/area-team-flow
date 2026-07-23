import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/lib/use-me";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNavigate } from "@tanstack/react-router";

type Notif = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export function NotificationsBell() {
  const { me } = useMe();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);

  const load = async () => {
    if (!me?.staff?.id) return;
    const { data } = await supabase
      .from("notifications").select("*")
      .eq("recipient_staff_id", me.staff.id)
      .order("created_at", { ascending: false }).limit(20);
    setItems((data as Notif[]) ?? []);
  };
  useEffect(() => { void load(); }, [me?.staff?.id]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [me?.staff?.id]);

  const unread = items.filter(i => !i.read_at).length;

  const open = async (n: Notif) => {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    }
    if (n.link) navigate({ to: n.link });
    load();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
              {unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 && <div className="p-3 text-xs text-muted-foreground">No notifications.</div>}
        {items.map(n => (
          <DropdownMenuItem key={n.id} onClick={() => open(n)} className="flex-col items-start gap-1">
            <div className={`text-sm font-medium ${n.read_at ? "" : "text-primary"}`}>{n.title}</div>
            {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
            <div className="text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleString()}</div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}