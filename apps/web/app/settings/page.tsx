"use client";

import { useState } from "react";
import { Download, Eraser, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export default function SettingsPage() {
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data & integritet</h1>
        <p className="text-sm text-muted-foreground">
          Din data lagras och bearbetas i EU. Den används aldrig för att träna modeller. Du kan ta med dig allt, eller radera allt, när du vill.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exportera allt</CardTitle>
          <CardDescription>Hela ditt minne, källor, konversationer, behörigheter och åtkomstlogg som öppen JSON.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/api/export">
            <Button variant="outline"><Download className="h-4 w-4" /> Ladda ner export</Button>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Radera råtext</CardTitle>
          <CardDescription>
            Ta bort de importerade konversationerna men behåll minnena som extraherats ur dem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              if (!confirm("Radera alla sparade konversationsmeddelanden?")) return;
              const r = await api<{ deletedMessages: number }>("/api/purge-messages", { method: "POST" });
              setMsg(`${r.deletedMessages} meddelanden raderade.`);
            }}
          >
            <Eraser className="h-4 w-4" /> Radera konversationer
          </Button>
          {msg && <p className="mt-2 text-sm text-muted-foreground">{msg}</p>}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Radera konto</CardTitle>
          <CardDescription>Allt raderas direkt: minnen, konversationer, anslutna verktyg och loggar. Det går inte att ångra.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={async () => {
              if (prompt("Skriv RADERA för att bekräfta") !== "RADERA") return;
              await api("/api/account", { method: "DELETE" });
              location.href = "/login";
            }}
          >
            <Trash2 className="h-4 w-4" /> Radera mitt konto
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
