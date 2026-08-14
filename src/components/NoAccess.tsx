import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

/** Shared "you don't have this permission" screen used by every guarded route. */
export function NoAccess({ what }: { what?: string }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground" />
        <h1 className="font-display text-xl uppercase tracking-[0.12em]">No access</h1>
        <p className="text-sm text-muted-foreground">
          {what
            ? `Your roles don't include "${what}".`
            : "Your roles don't include this page."}{" "}
          Ask an admin to grant it under Settings → People &amp; roles.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard">Back to schedule</Link>
        </Button>
      </div>
    </div>
  );
}
