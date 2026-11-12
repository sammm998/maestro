"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, Sparkles } from "lucide-react";
import { MemoryCard } from "@/components/memory-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { api, KIND_LABELS, type Memory, type MemoryKind } from "@/lib/api";
import { formatDate } from "@/lib/utils";

interface SearchResult {
  id: string;
  title: string;
  content: string;
  kind: MemoryKind;
  sourceName: string;
  validFrom: string;
  score: number;
}

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [kind, setKind] = useState<MemoryKind | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ memories: Memory[] }>(`/api/memories?status=${showInactive ? "all" : "active"}`);
    setMemories(res.memories);
  }, [showInactive]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const filtered = useMemo(() => (memories ?? []).filter((m) => kind === "all" || m.kind === kind), [memories, kind]);

  // Group by first linked project; everything else under "Övrigt".
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; items: Memory[]; last: number }>();
    for (const m of filtered) {
      const p = m.entities.find((e) => e.type === "project");
      const key = p?.id ?? "_other";
      const g = map.get(key) ?? { name: p?.name ?? "Övrigt", items: [], last: 0 };
      g.items.push(m);
      g.last = Math.max(g.last, new Date(m.validFrom).getTime());
      map.set(key, g);
    }
    return [...map.entries()].sort(([a, x], [b, y]) => (a === "_other" ? 1 : b === "_other" ? -1 : y.last - x.last));
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Partial<Record<MemoryKind, number>> = {};
    for (const m of memories ?? []) c[m.kind] = (c[m.kind] ?? 0) + 1;
    return c;
  }, [memories]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return setResults(null);
    const res = await api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
    setResults(res.results);
  }

  async function add() {
    if (!newText.trim()) return;
    await api("/api/memories", { method: "POST", body: JSON.stringify({ content: newText }) });
    setNewText("");
    setAdding(false);
    load();
  }

  if (memories === null) return <p className="text-muted-foreground">Laddar…</p>;

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mitt minne</h1>
          <p className="text-sm text-muted-foreground">
            {memories.length} minnen. Det här är vad dina AI-verktyg kan få låna, när du tillåter det.
          </p>
        </div>
        <Button variant="outline" onClick={() => setAdding((v) => !v)}>
          <Plus className="h-4 w-4" /> Lägg till minne
        </Button>
      </section>

      {adding && (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <Textarea autoFocus placeholder="T.ex. ”Jag föredrar korta svar på svenska.”" value={newText} onChange={(e) => setNewText(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>Avbryt</Button>
              <Button onClick={add}>Spara</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Testa minnet</CardTitle>
          <CardDescription>Skriv som du skulle skriva till ett AI-verktyg. Så här ser det ut när ett verktyg frågar Maestro.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={search} className="flex gap-2">
            <Input placeholder="”videoidén jag pratade om med ChatGPT”" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button><Search className="h-4 w-4" /> Sök</Button>
          </form>
          {results && (
            <ol className="mt-4 space-y-2">
              {results.length === 0 && <p className="text-sm text-muted-foreground">Inget matchade.</p>}
              {results.map((r, i) => (
                <li key={r.id} className="rounded-lg bg-muted p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                    <Badge>{KIND_LABELS[r.kind]}</Badge>
                    <Badge variant="outline">från {r.sourceName}, {formatDate(r.validFrom)}</Badge>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{r.score.toFixed(3)}</span>
                  </div>
                  <span className="font-medium">{r.title}</span> – {r.content}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {memories.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Ditt minne är tomt än så länge.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Börja med att <Link className="text-primary underline" href="/import">importera din ChatGPT- eller Claude-historik</Link>, eller
              anslut ett verktyg via MCP.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={kind === "all"} onClick={() => setKind("all")}>Alla ({memories.length})</FilterChip>
            {(Object.keys(KIND_LABELS) as MemoryKind[])
              .filter((k) => counts[k])
              .map((k) => (
                <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>
                  {KIND_LABELS[k]} ({counts[k]})
                </FilterChip>
              ))}
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Visa ersatta och arkiverade
            </label>
          </div>

          {groups.map(([key, g]) => (
            <section key={key}>
              <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold">
                {g.name}
                <span className="text-sm font-normal text-muted-foreground">{g.items.length}</span>
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {g.items.map((m) => (
                  <MemoryCard key={m.id} memory={m} onChange={load} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function FilterChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${active ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}
