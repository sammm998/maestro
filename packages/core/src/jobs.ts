/** Queue names shared by api/mcp (producers) and worker (consumer). */
export const QUEUES = {
  processConversation: "process-conversation",
  processImport: "process-import",
  decay: "memory-decay",
} as const;

export interface ProcessConversationJob {
  userId: string;
  conversationId: string;
  importId?: string;
}

export interface ProcessImportJob {
  userId: string;
  importId: string;
}

export type Enqueue = <T extends object>(queue: string, data: T) => Promise<void>;
