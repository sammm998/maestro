import { ImportFormatError, type ParsedConversation, type ParsedMessage } from "./types";

/**
 * Claude data export: `conversations.json` is an array of
 * { uuid, name, created_at, updated_at, chat_messages: [{ sender, text, content[], created_at }] }.
 */
interface ClaudeMsg {
  uuid?: string;
  sender?: string;
  text?: string;
  content?: { type?: string; text?: string }[];
  created_at?: string;
}
interface ClaudeConv {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeMsg[];
}

const toDate = (s?: string) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

function text(m: ClaudeMsg): string {
  const fromBlocks = (m.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("\n");
  return (fromBlocks || m.text || "").trim();
}

export function parseClaudeExport(json: unknown): ParsedConversation[] {
  if (!Array.isArray(json)) throw new ImportFormatError("Claude export: expected conversations.json to be an array");
  const out: ParsedConversation[] = [];
  for (const conv of json as ClaudeConv[]) {
    if (!conv || !Array.isArray(conv.chat_messages)) continue;
    const messages: ParsedMessage[] = [];
    for (const m of conv.chat_messages) {
      const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : undefined;
      const t = text(m);
      if (!role || !t) continue;
      messages.push({ role, content: t, createdAt: toDate(m.created_at) });
    }
    if (messages.length === 0) continue;
    out.push({
      externalId: conv.uuid ?? `${conv.name}-${conv.created_at}`,
      title: conv.name?.trim() || null,
      startedAt: toDate(conv.created_at) ?? messages[0]!.createdAt,
      endedAt: toDate(conv.updated_at) ?? messages.at(-1)!.createdAt,
      messages,
    });
  }
  return out;
}
