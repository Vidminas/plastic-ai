import type { Document } from 'mongoose';

/** Everything the model got on one turn, for the user's "Show what was sent". */
export interface ISentPrompt extends Document {
  user: string;
  conversationId: string;
  messageId: string;
  system: string;
  message: string;
  historyCount: number;
  tools: string[];
  truncated: boolean;
  createdAt?: Date;
  tenantId?: string;
}
