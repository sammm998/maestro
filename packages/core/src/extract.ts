import { z } from "zod";
import { ENTITY_TYPES, MEMORY_KINDS, SENSITIVITIES, type MemoryKind, type Sensitivity, type EntityType } from "@maestro/db";
import type { LLMProvider } from "@maestro/llm";
import { loadPrompt } from "./prompts";
import { looksLikeInjection } from "./safety";
import { clamp01 } from "./util";

export const EXTRACT_PROMPT_VERSION = "v1";

export const ExtractionSchema = z.object({
  memories: z.array(
    z.object({
      kind: z.enum(MEMORY_KINDS),
      title: z.string(),
      content: z.string(),
      importance: z.number(),
      confidence: z.number(),
      sensitivity: z.enum(SENSITIVITIES),
      entities: z.array(z.object({ type: z.enum(ENTITY_TYPES), name: z.string() })),
      source_message_indexes: z.array(z.number().int()),
      suspected_injection: z.boolean(),
    }),
  ),
});

export interface Candidate {
  kind: MemoryKind;
  title: string;
  content: string;
  importance: number;
  confidence: number;
  sensitivity: Sensitivity;
  entities: { type: EntityType; name: string }[];
  /** Ids of the messages the candidate came from. */
  sourceMessageIds: string[];
  flags: string[];
}

export interface ExtractInput {
  sourceLabel: string;
  title: string | null;
  startedAt: Date | null;
  messages: { id: string; role: string; content: string }[];
}

/** Max transcript characters per extraction call; longer chats are chunked. */
const CHUNK_CHARS = 24_000;
const MAX_MESSAGE_CHARS = 4_000;

export function buildTranscriptChunks(msgs: ExtractInput["messages"]): { lines: string; ids: string[] }[] {
  const chunks: { lines: string; ids: string[] }[] = [];
  let cur: string[] = [];
  let ids: string[] = [];
  let size = 0;
  msgs.forEach((m) => {
    if (m.role !== "user" && m.role !== "assistant") return;
    let content = m.content.replace(/\s+\n/g, "\n").trim();
    // Assistant replies are long and mostly generic; the user's words carry the signal.
    const cap = m.role === "assistant" ? MAX_MESSAGE_CHARS / 2 : MAX_MESSAGE_CHARS;
    if (content.length > cap) content = `${content.slice(0, cap)} […]`;
    const line = `[${ids.length}] ${m.role}: ${content}`;
    if (size + line.length > CHUNK_CHARS && cur.length > 0) {
      chunks.push({ lines: cur.join("\n\n"), ids });
      cur = [];
      ids = [];
      size = 0;
    }
    cur.push(`[${ids.length}] ${m.role}: ${content}`);
    ids.push(m.id);
    size += line.length;
  });
  if (cur.length > 0) chunks.push({ lines: cur.join("\n\n"), ids });
  return chunks;
}

/** Plan §6.2: per conversation, ask the LLM for candidate memories. */
export async function extractCandidates(llm: LLMProvider, input: ExtractInput): Promise<Candidate[]> {
  const prompt = loadPrompt("extract_memories", EXTRACT_PROMPT_VERSION);
  const out: Candidate[] = [];
  for (const chunk of buildTranscriptChunks(input.messages)) {
    const res = await llm.generateJson({
      task: prompt.id,
      tier: "fast",
      system: prompt.system,
      prompt: prompt.render({
        source_label: input.sourceLabel,
        date: input.startedAt ? input.startedAt.toISOString().slice(0, 10) : "unknown date",
        title: input.title ?? "(untitled)",
        transcript: chunk.lines,
      }),
      schema: ExtractionSchema,
    });
    for (const m of res.memories) {
      const title = m.title.trim().slice(0, 200);
      const content = m.content.trim().slice(0, 2000);
      if (!title || !content) continue;
      const flags: string[] = [];
      if (m.suspected_injection || looksLikeInjection(`${title}\n${content}`)) flags.push("suspected_injection");
      out.push({
        kind: m.kind,
        title,
        content,
        importance: clamp01(m.importance),
        confidence: clamp01(m.confidence),
        sensitivity: m.sensitivity,
        entities: dedupeEntities(m.entities),
        sourceMessageIds: m.source_message_indexes.map((i) => chunk.ids[i]).filter((x): x is string => !!x),
        flags,
      });
    }
  }
  return out;
}

function dedupeEntities(list: { type: EntityType; name: string }[]) {
  const seen = new Set<string>();
  return list
    .map((e) => ({ type: e.type, name: e.name.trim() }))
    .filter((e) => {
      const k = `${e.type}:${e.name.toLowerCase()}`;
      if (!e.name || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
