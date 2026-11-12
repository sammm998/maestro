"use client";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body && !isForm ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export type MemoryKind = "fact" | "preference" | "idea" | "project" | "task" | "person" | "decision" | "artifact";

export interface Memory {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  status: "active" | "superseded" | "archived";
  importance: number;
  confidence: number;
  sensitivity: "normal" | "private" | "special_category";
  flags: string[];
  sourceKind: string;
  sourceName: string;
  validFrom: string;
  useCount: number;
  lastUsedAt: string | null;
  entities: { id: string; type: string; name: string }[];
}

export interface Project {
  id: string;
  type: string;
  name: string;
  memoryCount: number;
  lastActivity: string | null;
}

export const KIND_LABELS: Record<MemoryKind, string> = {
  idea: "Idé",
  project: "Projekt",
  preference: "Preferens",
  decision: "Beslut",
  task: "Uppgift",
  person: "Person",
  fact: "Fakta",
  artifact: "Artefakt",
};

export const SENSITIVITY_LABELS = { normal: "Normal", private: "Privat", special_category: "Känslig (art. 9)" } as const;
