"use client";

import { useState } from "react";
import { Archive, Check, Pencil, ShieldAlert, Trash2, X } from "lucide-react";
import { api, KIND_LABELS, SENSITIVITY_LABELS, type Memory, type MemoryKind } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";

export function MemoryCard({ memory, onChange }: { memory: Memory; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: memory.title, content: memory.content, kind: memory.kind, sensitivity: memory.sensitivity });
  const [busy, setBusy] = useState(false);
  const flagged = memory.flags.includes("suspected_injection");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/memories/${memory.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setEditing(false);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Radera minnet permanent? Det går inte att ångra.")) return;
    await api(`/api/memories/${memory.id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className={`group rounded-xl border bg-card p-4 ${flagged ? "border-warning" : "border-border"} ${memory.status !== "active" ? "opacity-60" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Badge>{KIND_LABELS[memory.kind]}</Badge>
        <Badge variant="outline">
          från {memory.sourceName}, {formatDate(memory.validFrom)}
        </Badge>
        {memory.sensitivity !== "normal" && <Badge variant="danger">{SENSITIVITY_LABELS[memory.sensitivity]}</Badge>}
        {memory.status !== "active" && <Badge variant="outline">{memory.status === "superseded" ? "Ersatt" : "Arkiverad"}</Badge>}
        {flagged && (
          <Badge variant="warning">
            <ShieldAlert className="h-3 w-3" /> Misstänkt instruktion
          </Badge>
        )}
        {memory.useCount > 0 && <span className="text-xs text-muted-foreground">läst {memory.useCount}×</span>}
        <div className="ml-auto flex gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          {!editing && (
            <Button variant="ghost" size="icon" title="Redigera" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {memory.status === "active" && (
            <Button variant="ghost" size="icon" title="Arkivera" onClick={() => patch({ status: "archived" })}>
              <Archive className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" title="Radera" onClick={remove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <Textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            <select
              className="h-8 rounded-md border border-border bg-card px-2 text-sm"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as MemoryKind })}
            >
              {Object.entries(KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              className="h-8 rounded-md border border-border bg-card px-2 text-sm"
              value={draft.sensitivity}
              onChange={(e) => setDraft({ ...draft, sensitivity: e.target.value as Memory["sensitivity"] })}
            >
              {Object.entries(SENSITIVITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="h-4 w-4" /> Avbryt</Button>
              <Button size="sm" disabled={busy} onClick={() => patch(draft)}><Check className="h-4 w-4" /> Spara</Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <h4 className="font-medium leading-snug">{memory.title}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{memory.content}</p>
          {flagged && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-warning/15 p-2 text-xs">
              Texten ser ut att försöka ge instruktioner till AI-verktyg, så den lämnas inte ut.
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => patch({ clearFlags: true })}>
                Det är okej
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
