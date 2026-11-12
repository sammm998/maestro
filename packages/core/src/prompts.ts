import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../prompts");

export interface Prompt {
  /** e.g. "extract_memories@v1" — passed to the LLM layer as task name. */
  id: string;
  system: string;
  render(vars: Record<string, string>): string;
}

const cache = new Map<string, Prompt>();

/** Load `prompts/<name>.<version>.md` (sections split by <!-- system --> / <!-- user -->). */
export function loadPrompt(name: string, version: string): Prompt {
  const key = `${name}@${version}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const raw = readFileSync(path.join(PROMPTS_DIR, `${name}.${version}.md`), "utf8");
  const m = raw.match(/<!-- system -->([\s\S]*?)<!-- user -->([\s\S]*)$/);
  if (!m) throw new Error(`Prompt ${key} is missing system/user sections`);
  const system = m[1]!.trim();
  const template = m[2]!.trim();
  const prompt: Prompt = {
    id: key,
    system,
    render: (vars) =>
      template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
        if (!(k in vars)) throw new Error(`Prompt ${key}: missing variable ${k}`);
        return vars[k]!;
      }),
  };
  cache.set(key, prompt);
  return prompt;
}
