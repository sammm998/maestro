import { ImportFormatError, type ParsedConversation, type ParsedMessage } from "./types";

/**
 * ChatGPT data export: `conversations.json` is an array of conversations, each
 * holding a `mapping` tree of message nodes (edits/regenerations create
 * branches). We follow `current_node` back to the root to get the branch the
 * user actually saw last.
 */
interface Node {
  id: string;
  parent?: string | null;
  children?: string[];
  message?: {
    author?: { role?: string };
    create_time?: number | null;
    content?: { content_type?: string; parts?: unknown[]; text?: string };
    metadata?: Record<string, unknown>;
  } | null;
}

interface Conv {
  id?: string;
  conversation_id?: string;
  title?: string | null;
  create_time?: number | null;
  update_time?: number | null;
  current_node?: string | null;
  mapping?: Record<string, Node>;
}

const TEXT_TYPES = new Set(["text", "multimodal_text", "code"]);

const toDate = (s: number | null | undefined) => (typeof s === "number" && s > 0 ? new Date(s * 1000) : null);

function messageText(m: NonNullable<Node["message"]>): string {
  const c = m.content;
  if (!c || !TEXT_TYPES.has(c.content_type ?? "text")) return "";
  if (typeof c.text === "string") return c.text;
  return (c.parts ?? [])
    .map((p) => (typeof p === "string" ? p : typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text) : ""))
    .filter(Boolean)
    .join("\n");
}

function mainBranch(conv: Conv): Node[] {
  const mapping = conv.mapping ?? {};
  let leaf = conv.current_node ?? undefined;
  if (!leaf || !mapping[leaf]) {
    // Fallback: follow the last child from the root.
    const root = Object.values(mapping).find((n) => !n.parent);
    let cur = root;
    while (cur?.children?.length) cur = mapping[cur.children[cur.children.length - 1]!];
    leaf = cur?.id;
  }
  const path: Node[] = [];
  const seen = new Set<string>();
  while (leaf && mapping[leaf] && !seen.has(leaf)) {
    seen.add(leaf);
    path.push(mapping[leaf]!);
    leaf = mapping[leaf]!.parent ?? undefined;
  }
  return path.reverse();
}

export function parseChatGPTExport(json: unknown): ParsedConversation[] {
  if (!Array.isArray(json)) throw new ImportFormatError("ChatGPT export: expected conversations.json to be an array");
  const out: ParsedConversation[] = [];
  for (const conv of json as Conv[]) {
    if (!conv || typeof conv !== "object" || !conv.mapping) continue;
    const messages: ParsedMessage[] = [];
    for (const node of mainBranch(conv)) {
      const m = node.message;
      const role = m?.author?.role;
      if (!m || (role !== "user" && role !== "assistant")) continue;
      if (m.metadata?.is_visually_hidden_from_conversation) continue;
      const text = messageText(m).trim();
      if (!text) continue;
      messages.push({ role, content: text, createdAt: toDate(m.create_time) });
    }
    if (messages.length === 0) continue;
    out.push({
      externalId: String(conv.conversation_id ?? conv.id ?? `${conv.title}-${conv.create_time}`),
      title: conv.title ?? null,
      startedAt: toDate(conv.create_time) ?? messages[0]!.createdAt,
      endedAt: toDate(conv.update_time) ?? messages.at(-1)!.createdAt,
      messages,
    });
  }
  return out;
}
