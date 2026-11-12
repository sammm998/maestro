"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDate, timeAgo } from "@/lib/utils";

interface Grant {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  projects: string[] | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
  calls: number;
  memoriesRead: number;
  lastUsedAt: string | null;
}

interface LogEntry {
  id: string;
  action: string;
  query: string | null;
  createdAt: string;
  memories: { id: string; title: string }[];
}

const ACTIONS: Record<string, string> = {
  get_context: "Hämtade kontext",
  recall: "Sökte",
  remember: "Sparade",
  log_conversation: "Loggade samtal",
  list_projects: "Listade projekt",
  forget: "Glömde",
  read_profile: "Läste profil",
  read_project: "Läste projekt",
  handoff: "Handoff",
  grant_created: "Fick åtkomst",
  grant_revoked: "Åtkomst återkallad",
};

const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? "http://localhost:8788/mcp";

export default function ToolsPage() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(() => api<{ grants: Grant[] }>("/api/grants").then((r) => setGrants(r.grants)), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function toggle(g: Grant) {
    if (open === g.id) return setOpen(null);
    setOpen(g.id);
    const r = await api<{ entries: LogEntry[] }>(`/api/access-log?clientId=${g.clientId}`);
    setLog(r.entries);
  }

  async function revoke(g: Grant) {
    if (!confirm(`Återkalla ${g.clientName}s åtkomst? Verktyget slutar direkt att kunna läsa ditt minne.`)) return;
    await api(`/api/grants/${g.id}`, { method: "DELETE" });
    load();
  }

  const active = grants?.filter((g) => g.active) ?? [];
  const inactive = grants?.filter((g) => !g.active) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Anslutna verktyg</h1>
        <p className="text-sm text-muted-foreground">Verktygen lånar ditt minne. Här ser du exakt vad varje verktyg har läst, och tar tillbaka åtkomsten när du vill.</p>
      </div>

      {grants === null ? (
        <p className="text-muted-foreground">Laddar…</p>
      ) : (
        <div className="space-y-3">
          {active.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">Inga verktyg är anslutna ännu.</CardContent></Card>
          )}
          {[...active, ...(showInactive ? inactive : [])].map((g) => (
            <Card key={g.id} className={g.active ? "" : "opacity-60"}>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-center gap-3">
                  <button className="flex items-center gap-2 font-medium" onClick={() => toggle(g)}>
                    {open === g.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {g.clientName}
                  </button>
                  {g.active ? <Badge>Aktiv</Badge> : <Badge variant="outline">{g.revokedAt ? "Återkallad" : "Utgången"}</Badge>}
                  {g.scopes.map((s) => (
                    <Badge key={s} variant="outline">{s}</Badge>
                  ))}
                  {g.projects && <Badge variant="warning">{g.projects.length} projekt</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {g.calls} anrop · {g.memoriesRead} {g.memoriesRead === 1 ? "minne läst" : "minnen lästa"} · {g.lastUsedAt ? `senast ${timeAgo(g.lastUsedAt)}` : "aldrig använd"}
                    {g.expiresAt && g.active && ` · gäller till ${formatDate(g.expiresAt)}`}
                  </span>
                  {g.active && (
                    <Button variant="destructive" size="sm" onClick={() => revoke(g)}>Återkalla</Button>
                  )}
                </div>
                {open === g.id && (
                  <ul className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
                    {log.length === 0 && <li className="text-muted-foreground">Inga anrop ännu.</li>}
                    {log.map((e) => (
                      <li key={e.id} className="flex flex-wrap gap-x-3 gap-y-1">
                        <span className="w-28 shrink-0 text-xs text-muted-foreground">{timeAgo(e.createdAt)}</span>
                        <span className="font-medium">{ACTIONS[e.action] ?? e.action}</span>
                        {e.query && <span className="text-muted-foreground">”{e.query}”</span>}
                        {e.memories.length > 0 && (
                          <span className="w-full pl-31 text-xs text-muted-foreground">läste: {e.memories.map((m) => m.title).join(" · ")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {inactive.length > 0 && (
        <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setShowInactive((v) => !v)}>
          {showInactive ? "Dölj" : "Visa"} tidigare anslutningar ({inactive.length})
        </button>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plug className="h-4 w-4" /> Anslut ett nytt verktyg</CardTitle>
          <CardDescription>Maestro är en MCP-server. Lägg till den här adressen i verktyget, logga in och godkänn.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center gap-2 rounded-lg bg-muted p-2 font-mono">
            <span className="truncate">{MCP_URL}</span>
            <Button variant="ghost" size="icon" className="ml-auto" title="Kopiera" onClick={() => navigator.clipboard.writeText(MCP_URL)}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><span className="font-medium text-foreground">Claude:</span> Inställningar → Connectors → Lägg till custom connector → klistra in adressen.</li>
            <li><span className="font-medium text-foreground">ChatGPT:</span> Inställningar → Apps & Connectors → slå på Developer mode → Create → klistra in adressen, välj OAuth.</li>
            <li><span className="font-medium text-foreground">Cursor:</span> lägg till <code className="rounded bg-muted px-1">{`{"mcpServers":{"maestro":{"url":"${MCP_URL}"}}}`}</code> i mcp.json.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
