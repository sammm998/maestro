"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, next: params.get("next") ?? "/" }),
    });
    if (!res.ok) return setState("error");
    const body = (await res.json()) as { devLink?: string };
    setDevLink(body.devLink ?? null);
    setState("sent");
  }

  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary text-2xl text-primary-foreground">𝄞</div>
        <h1 className="text-2xl font-semibold tracking-tight">Maestro</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ett minne som alla dina AI-verktyg delar. Du äger det.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Logga in</CardTitle>
          <CardDescription>Vi skickar en inloggningslänk till din e-post. Inget lösenord.</CardDescription>
        </CardHeader>
        <CardContent>
          {params.get("error") === "expired" && (
            <p className="mb-3 text-sm text-destructive">Länken har gått ut eller redan använts. Be om en ny.</p>
          )}
          {state === "sent" ? (
            <div className="space-y-3 text-sm">
              <p>Kolla din inkorg för {email}.</p>
              {devLink && (
                <p className="rounded-md bg-muted p-3">
                  Utvecklingsläge: <a className="font-medium text-primary underline" href={devLink}>öppna inloggningslänken</a>
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <Input type="email" required autoFocus placeholder="du@exempel.se" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button className="w-full" disabled={state === "sending"}>
                {state === "sending" ? "Skickar…" : "Skicka inloggningslänk"}
              </Button>
              {state === "error" && <p className="text-sm text-destructive">Något gick fel. Försök igen.</p>}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
