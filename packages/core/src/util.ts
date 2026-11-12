import { createHash } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Rough token estimate (≈4 chars/token) used for context packing budgets. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

const SV_EN_STOPWORDS = new Set(
  (
    "a an the and or of to in on at for with from by is are was were be been it this that these those i you he she we they me my your our " +
    "do did does about what which who how when where why can could would should will just jag du han hon vi ni de den det en ett och eller " +
    "att som på i av för med till från är var har hade om men så vad vilken vilket hur när där varför kan kunde skulle ska min mitt mina din " +
    "ditt dina vår vårt våra sig sin sitt sina inte också bara nu då här the jag mig dig oss er dem honom henne"
  ).split(/\s+/),
);

/** Lowercased word tokens without stopwords. */
export function tokenize(text: string): string[] {
  const toks = text.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  return toks.filter((t) => t.length > 1 && !SV_EN_STOPWORDS.has(t));
}

export function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Parse "7d", "24h", "2w" or an ISO date into a Date. */
export function parseSince(since: string | undefined, now: Date): Date | undefined {
  if (!since) return undefined;
  const rel = since.trim().match(/^(\d+)\s*([hdwm])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unitMs = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3 }[rel[2]!.toLowerCase() as "h" | "d" | "w" | "m"];
    return new Date(now.getTime() - n * unitMs);
  }
  const d = new Date(since);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
