import { z } from "zod";
import { LLMError } from "./types";

/** Small fetch wrapper with retry on 429/5xx for REST providers (Mistral, OpenAI). */
export async function postJson(
  provider: string,
  url: string,
  apiKey: string,
  body: unknown,
  retries = 3,
): Promise<unknown> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = new LLMError(`${provider}: connection error: ${(e as Error).message}`, provider, true);
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    lastErr = new LLMError(`${provider}: HTTP ${res.status}: ${text.slice(0, 300)}`, provider, retryable);
    if (!retryable) throw lastErr;
    await sleep(backoff(attempt));
  }
  throw lastErr!;
}

const backoff = (attempt: number) => Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse model text output as JSON and validate it against the zod schema. */
export function parseJsonOutput<T>(provider: string, task: string, text: string, schema: z.ZodType<T>): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new LLMError(`${task}: output was not valid JSON`, provider, true);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new LLMError(`${task}: output failed schema: ${parsed.error.message}`, provider, true);
  return parsed.data;
}

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
}
