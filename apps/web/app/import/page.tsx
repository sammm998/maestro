"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

interface Import {
  id: string;
  kind: "chatgpt" | "claude";
  filename: string | null;
  status: "parsing" | "processing" | "done" | "failed";
  conversationsTotal: number;
  conversationsDone: number;
  error: string | null;
  createdAt: string;
}

const STATUS = { parsing: "Läser fil", processing: "Bearbetar", done: "Klar", failed: "Misslyckades" } as const;

export default function ImportPage() {
  const [imports, setImports] = useState<Import[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<{ imports: Import[] }>("/api/imports").then((r) => setImports(r.imports)), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  useEffect(() => {
    if (!imports.some((i) => i.status === "processing" || i.status === "parsing")) return;
    const t = setInterval(() => load().catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [imports, load]);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    const form = new FormData();
    form.set("file", file);
    try {
      await api("/api/imports", { method: "POST", body: form });
      await load();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { message?: string; error?: string }) : undefined;
      setError(body?.message ?? body?.error ?? "Uppladdningen misslyckades.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importera historik</h1>
        <p className="text-sm text-muted-foreground">
          Ladda upp din dataexport så bygger Maestro ditt minne från allt du redan pratat om. Du kan importera samma fil igen – bara nya meddelanden läses.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-10 text-center hover:bg-muted"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) upload(f);
            }}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="font-medium">{uploading ? "Laddar upp…" : "Släpp din export här eller klicka för att välja"}</span>
            <span className="text-sm text-muted-foreground">.zip från ChatGPT eller Claude, eller conversations.json</span>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.json,application/zip,application/json"
              className="hidden"
              disabled={uploading}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ChatGPT</CardTitle>
            <CardDescription>
              Inställningar → Datakontroller → Exportera data. Du får ett mejl med en zip-fil.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Claude</CardTitle>
            <CardDescription>Settings → Privacy → Export data. Du får ett mejl med en zip-fil.</CardDescription>
          </CardHeader>
        </Card>
      </div>

      {imports.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Tidigare importer</h2>
          <div className="space-y-2">
            {imports.map((i) => {
              const pct = i.conversationsTotal ? Math.round((i.conversationsDone / i.conversationsTotal) * 100) : 100;
              return (
                <Card key={i.id}>
                  <CardContent className="flex flex-wrap items-center gap-3 pt-5">
                    <Badge>{i.kind === "chatgpt" ? "ChatGPT" : "Claude"}</Badge>
                    <span className="text-sm">{i.filename}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(i.createdAt)}</span>
                    <span className="ml-auto text-sm">
                      {STATUS[i.status]} · {i.conversationsDone}/{i.conversationsTotal} konversationer
                    </span>
                    {i.status === "processing" && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {i.error && <p className="w-full text-sm text-destructive">{i.error}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
