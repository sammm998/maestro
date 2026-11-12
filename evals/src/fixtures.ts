import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EntityType, MemoryKind, Sensitivity, SourceKind } from "@maestro/db";

export interface FixtureMemory {
  label: string;
  kind: MemoryKind;
  source: SourceKind;
  daysAgo: number;
  importance: number;
  title: string;
  content: string;
  status?: "active" | "superseded";
  sensitivity?: Sensitivity;
  entities?: [EntityType, string][];
}

export interface FixtureQuery {
  q: string;
  expect: string[];
  forbid?: string[];
}

export interface Fixture {
  user: string;
  description: string;
  memories: FixtureMemory[];
  queries: FixtureQuery[];
}

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

export function loadFixtures(only?: string): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, f), "utf8")) as Fixture)
    .filter((f) => !only || f.user === only);
}

export const SOURCE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  lovable: "Lovable",
  higgsfield: "Higgsfield",
  cursor: "Cursor",
};
