import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KadirLogo } from "@/components/KadirLogo";
import { AppSignature } from "@/components/AppSignature";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — KADIR Staff Management" },
      { name: "description", content: "Sign in to KADIR to manage hospital staff schedules and leave." },
      { property: "og:title", content: "Sign in — KADIR Staff Management" },
      { property: "og:description", content: "Sign in to KADIR to manage hospital staff schedules and leave." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const signIn = async () => {
    setError(null);
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (res.error) setError(res.error.message ?? "Sign-in failed");
    if (!res.error && !res.redirected) navigate({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen bg-bone flex items-center justify-center p-6">
      <Card className="w-full max-w-md overflow-hidden border bg-card text-card-foreground shadow-lg">
        <div className="flex justify-center px-8 pt-7 pb-5">
          <KadirLogo size="lg" />
        </div>
        <CardContent className="space-y-4 px-8 pb-8">
          <Button
            className="w-full font-semibold uppercase tracking-[0.18em]"
            onClick={signIn}
          >
            Continue with Google
          </Button>
          {error && <p className="text-sm text-destructive-foreground text-center">{error}</p>}
          <p className="text-xs text-muted-foreground text-center">
            Access is granted to hospital staff on the roster only.
          </p>
          <div className="flex justify-center border-t pt-3">
            <AppSignature />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}