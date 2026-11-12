"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type Project } from "@/lib/api";

const SCOPE_TEXT: Record<string, { title: string; detail: string }> = {
  "memory:read": { title: "Läsa ditt minne", detail: "Hämta projekt, idéer, preferenser och beslut som är relevanta för det du gör." },
  "memory:write": { title: "Spara nya minnen", detail: "Lägga till sådant du säger åt verktyget att komma ihåg, och logga samtal." },
  "memory:read:private": { title: "Läsa privata minnen", detail: "Ekonomi, adresser, relationer och liknande." },
  "memory:read:special": { title: "Läsa känsliga minnen", detail: "Hälsa, religion, politik m.m. (GDPR art. 9). Ge bara om du verkligen vill." },
};

interface RequestInfo {
  client: { id: string; name: string; verified: boolean };
  redirectHost: string;
  scopes: string[];
}

function Consent() {
  const params = useSearchParams();
  const requestId = params.get("request");
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [scopes, setScopes] = useState<string[]>([]);
  const [expires, setExpires] = useState<string>("90");
  const [projects, setProjects] = useState<Project[]>([]);
  const [onlyProjects, setOnlyProjects] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    api<RequestInfo>(`/api/oauth/requests/${requestId}`)
      .then((r) => {
        setInfo(r);
        setScopes(r.scopes.filter((s) => s === "memory:read" || s === "memory:write"));
      })
      .catch(() => setError("expired"));
    api<{ projects: Project[] }>("/api/projects").then((r) => setProjects(r.projects)).catch(() => {});
  }, [requestId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const r = await api<{ redirect: string }>(`/api/oauth/requests/${requestId}/decision`, {
      method: "POST",
      body: JSON.stringify({ approve, scopes, projects: onlyProjects, expiresInDays: expires === "never" ? null : Number(expires) }),
    });
    location.href = r.redirect;
  }

  if (error)
    return (
      <Card className="mx-auto mt-12 max-w-lg">
        <CardHeader>
          <CardTitle>Anslutningen kunde inte startas</CardTitle>
          <CardDescription>
            {error === "invalid_client" ? "Verktyget är inte registrerat eller använde en otillåten adress." : "Förfrågan har gått ut. Starta anslutningen igen från verktyget."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  if (!info) return <p className="text-muted-foreground">Laddar…</p>;

  return (
    <Card className="mx-auto mt-8 max-w-lg">
      <CardHeader>
        <CardTitle className="text-xl">{info.client.name} vill låna ditt minne</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          {info.client.verified ? (
            <><ShieldCheck className="h-4 w-4 text-primary" /> Verifierad app</>
          ) : (
            <><ShieldAlert className="h-4 w-4" /> Overifierad app · skickar dig tillbaka till {info.redirectHost}</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          {info.scopes.concat(info.scopes.includes("memory:read") ? [] : ["memory:read"]).map((s) => (
            <label key={s} className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 hover:bg-muted">
              <input
                type="checkbox"
                className="mt-1"
                checked={scopes.includes(s)}
                onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
              />
              <span>
                <span className="block text-sm font-medium">{SCOPE_TEXT[s]?.title ?? s}</span>
                <span className="block text-xs text-muted-foreground">{SCOPE_TEXT[s]?.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {projects.length > 0 && (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onlyProjects !== null} onChange={(e) => setOnlyProjects(e.target.checked ? [] : null)} />
              Begränsa till vissa projekt
            </label>
            {onlyProjects !== null && (
              <div className="flex flex-wrap gap-1.5 pl-6">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setOnlyProjects(onlyProjects.includes(p.id) ? onlyProjects.filter((x) => x !== p.id) : [...onlyProjects, p.id])}
                    className={`rounded-full border px-2.5 py-0.5 ${onlyProjects.includes(p.id) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          Åtkomsten gäller
          <select className="h-8 rounded-md border border-border bg-card px-2" value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option value="1">1 dag</option>
            <option value="7">7 dagar</option>
            <option value="30">30 dagar</option>
            <option value="90">90 dagar</option>
            <option value="never">tills jag återkallar</option>
          </select>
        </label>

        <p className="text-xs text-muted-foreground">
          Verktyget lånar bara det som behövs för stunden. Du ser exakt vad det har läst under Anslutna verktyg, och kan återkalla med ett klick.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>Neka</Button>
          <Button className="flex-1" disabled={busy || !scopes.includes("memory:read") || (onlyProjects?.length === 0)} onClick={() => decide(true)}>
            Tillåt
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ConnectPage() {
  return (
    <Suspense>
      <Consent />
    </Suspense>
  );
}
