export type ExportKind = "chatgpt" | "claude";

export interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date | null;
}

export interface ParsedConversation {
  externalId: string;
  title: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  messages: ParsedMessage[];
}

export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFormatError";
  }
}
