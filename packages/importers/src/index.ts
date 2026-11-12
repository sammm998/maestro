import { strFromU8, unzipSync } from "fflate";
import { parseChatGPTExport } from "./chatgpt";
import { parseClaudeExport } from "./claude";
import { ImportFormatError, type ExportKind, type ParsedConversation } from "./types";

export * from "./types";
export { parseChatGPTExport } from "./chatgpt";
export { parseClaudeExport } from "./claude";

/** Max uncompressed size of conversations.json we accept (DoS guard). */
const MAX_JSON_BYTES = 512 * 1024 * 1024;

/** Accept the export zip or a bare conversations.json and return its JSON. */
export function readExportFile(bytes: Uint8Array): unknown {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let jsonText: string;
  if (isZip) {
    const files = unzipSync(bytes, {
      filter: (f) => /(^|\/)conversations\.json$/.test(f.name) && f.originalSize <= MAX_JSON_BYTES,
    });
    const entry = Object.values(files)[0];
    if (!entry) throw new ImportFormatError("Zip file does not contain conversations.json");
    jsonText = strFromU8(entry);
  } else {
    if (bytes.byteLength > MAX_JSON_BYTES) throw new ImportFormatError("File too large");
    jsonText = new TextDecoder().decode(bytes);
  }
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new ImportFormatError("conversations.json is not valid JSON");
  }
}

/** Guess which product produced an export from its shape. */
export function detectExportKind(json: unknown): ExportKind | undefined {
  if (!Array.isArray(json) || json.length === 0) return undefined;
  const first = json[0] as Record<string, unknown>;
  if (first && "mapping" in first) return "chatgpt";
  if (first && "chat_messages" in first) return "claude";
  return undefined;
}

export function parseExport(bytes: Uint8Array, kind?: ExportKind): { kind: ExportKind; conversations: ParsedConversation[] } {
  const json = readExportFile(bytes);
  const k = kind ?? detectExportKind(json);
  if (!k) throw new ImportFormatError("Could not recognise the export format (expected ChatGPT or Claude conversations.json)");
  return { kind: k, conversations: k === "chatgpt" ? parseChatGPTExport(json) : parseClaudeExport(json) };
}
