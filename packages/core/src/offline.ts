/**
 * Heuristic stand-ins for the LLM tasks, used when LLM_PROVIDER=mock (local dev
 * without API keys, CI). Quality is far below a real model — this exists so the
 * whole product runs end-to-end offline. Never used when a real provider is set.
 */
import type { MockJsonHandler } from "@maestro/llm";
import type { MemoryKind } from "@maestro/db";
import { jaccard } from "./util";

const KIND_RULES: [RegExp, MemoryKind, number][] = [
  [/\b(bestämt|bestämde|vi kör på|decided|we('ll| will) go with|let's go with|beslut)/i, "decision", 0.7],
  [/\b(föredrar|prefer|gillar inte|don't like|always|alltid|aldrig|never|hatar|love|älskar|i like|jag gillar)/i, "preference", 0.6],
  [/\b(idé|ide|idea|vill göra|want to make|i want to create|planerar|planning|koncept|concept|tänker göra)/i, "idea", 0.75],
  [/\b(projekt|project|bygger|building|startup|appen|my app|min app)/i, "project", 0.7],
  [/\b(måste|need to|todo|to-do|remind me|påminn|ska fixa|have to)/i, "task", 0.5],
  [/\b(jag heter|my name is|jag jobbar|i work|jag bor|i live)/i, "fact", 0.6],
];

const SENSITIVE: [RegExp, "private" | "special_category"][] = [
  [/\b(diagnos|depression|adhd|cancer|sjukdom|illness|medicin|medication|religion|religiös|politisk|political|sexuell|sexual)/i, "special_category"],
  [/\b(lön|salary|skuld|debt|personnummer|adress|address|telefon|phone)/i, "private"],
];

function guessEntities(text: string) {
  const out: { type: "project" | "topic"; name: string }[] = [];
  const quoted = text.match(/["“']([^"”']{3,40})["”']/g) ?? [];
  for (const q of quoted) out.push({ type: "project", name: q.replace(/["“”']/g, "") });
  const caps = text.match(/(?<![.!?]\s)(?<!^)\b[A-ZÅÄÖ][\p{L}\p{N}-]{2,}/gu) ?? [];
  for (const c of caps.slice(0, 4)) out.push({ type: "topic", name: c });
  return out;
}

export const offlineExtract: MockJsonHandler = (req) => {
  const transcript = req.prompt.match(/<transcript>\n([\s\S]*?)\n<\/transcript>/)?.[1] ?? "";
  const lines = transcript.split(/\n\n(?=\[\d+\] )/);
  const memories = [];
  for (const line of lines) {
    const m = line.match(/^\[(\d+)\] user: ([\s\S]*)$/);
    if (!m) continue;
    const text = m[2]!.trim();
    if (text.length < 30) continue;
    const rule = KIND_RULES.find(([re]) => re.test(text));
    if (!rule) continue;
    const sentence = text.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ").slice(0, 400);
    const sens = SENSITIVE.find(([re]) => re.test(text))?.[1] ?? "normal";
    memories.push({
      kind: rule[1],
      title: sentence.split(/\s+/).slice(0, 8).join(" ").replace(/[.,!?]$/, ""),
      content: `Användaren: ${sentence}`,
      importance: rule[2],
      confidence: 0.6,
      sensitivity: sens,
      entities: guessEntities(text),
      source_message_indexes: [Number(m[1])],
      suspected_injection: false,
    });
    if (memories.length >= 12) break;
  }
  return { memories };
};

export const offlineResolve: MockJsonHandler = (req) => {
  const cand = req.prompt.match(/<candidate>\ntitle: (.*)\ncontent: ([\s\S]*?)\n<\/candidate>/);
  const existing = [...req.prompt.matchAll(/<existing id="([^"]+)"[^>]*>\ntitle: (.*)\ncontent: ([\s\S]*?)\n<\/existing>/g)];
  const text = cand ? `${cand[1]} ${cand[2]}` : "";
  let best: { id: string; sim: number } | undefined;
  for (const e of existing) {
    const sim = jaccard(text, `${e[2]} ${e[3]}`);
    if (!best || sim > best.sim) best = { id: e[1]!, sim };
  }
  if (best && best.sim > 0.75) return { action: "SKIP", target_id: best.id, title: null, content: null, reason: "near duplicate" };
  if (best && best.sim > 0.45) return { action: "UPDATE", target_id: best.id, title: null, content: cand?.[2] ?? null, reason: "same topic" };
  return { action: "ADD", target_id: null, title: null, content: null, reason: "new" };
};

export const offlineHandlers: Record<string, MockJsonHandler> = {
  extract_memories: offlineExtract,
  resolve_memory: offlineResolve,
};
