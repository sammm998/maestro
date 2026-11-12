/**
 * Prompt-injection hygiene (plan §5, §10). Memories are user DATA that we hand
 * to other models, so we (1) flag text that looks like instructions to AI
 * systems at ingest and (2) neutralise our own delimiters when rendering.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts|messages)/i,
  /disregard (all |the )?(previous|prior|above|system)/i,
  /ignorera (alla )?(tidigare|föregående) (instruktioner|meddelanden)/i,
  /\byou are now\b/i,
  /\b(system prompt|developer message)\b/i,
  /when (an? )?(ai|assistant|model|llm) reads this/i,
  /<\/?\s*(user_memory|system|assistant|tool_call|function_call)\b/i,
  /\b(call|invoke|use) the (tool|function) [`'"]?\w+/i,
  /\b(exfiltrate|send (all|the) (memories|data) to)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/** Make sure stored text can never close or open our <user_memory> envelope. */
export function neutraliseDelimiters(text: string): string {
  return text.replace(/<(\/?)\s*user_memory/gi, "‹$1user_memory");
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
