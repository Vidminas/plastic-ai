import type { TSentPrompt } from 'librechat-data-provider';
import type { ISentPrompt } from '~/types/sentPrompt';

export type SentPromptInput = Omit<TSentPrompt, 'createdAt'> & {
  user: string;
  conversationId: string;
  messageId: string;
};

export interface SentPromptMethods {
  /** Keeps what a turn sent; a regenerated reply replaces what its message sent before. */
  saveSentPrompt(input: SentPromptInput): Promise<void>;
  /** What this user's message sent, or null when nothing was kept for it. */
  getSentPrompt(
    user: string,
    conversationId: string,
    messageId: string,
  ): Promise<TSentPrompt | null>;
  deleteSentPromptsByUser(user: string): Promise<void>;
}

const toSentPrompt = (doc: ISentPrompt): TSentPrompt => ({
  system: doc.system ?? '',
  message: doc.message ?? '',
  historyCount: doc.historyCount ?? 0,
  tools: doc.tools ?? [],
  truncated: doc.truncated === true,
  ...(doc.createdAt ? { createdAt: doc.createdAt.toISOString() } : {}),
});

/**
 * Deletes what the messages of deleted conversations sent. Called from `deleteConvos`, so
 * whatever removes a conversation removes these with it.
 */
export async function deleteConversationSentPrompts(
  mongoose: typeof import('mongoose'),
  user: string,
  conversationIds: string[],
): Promise<void> {
  if (conversationIds.length === 0) {
    return;
  }
  await mongoose.models.SentPrompt?.deleteMany({ user, conversationId: { $in: conversationIds } });
}

export function createSentPromptMethods(mongoose: typeof import('mongoose')): SentPromptMethods {
  const model = () => mongoose.models.SentPrompt;

  async function saveSentPrompt({ user, messageId, ...rest }: SentPromptInput): Promise<void> {
    await model().findOneAndUpdate(
      { user, messageId },
      { $set: { ...rest, user, messageId, createdAt: new Date() } },
      { upsert: true, runValidators: true, timestamps: false },
    );
  }

  async function getSentPrompt(
    user: string,
    conversationId: string,
    messageId: string,
  ): Promise<TSentPrompt | null> {
    const doc = await model().findOne({ user, conversationId, messageId }).lean<ISentPrompt>();
    return doc ? toSentPrompt(doc) : null;
  }

  async function deleteSentPromptsByUser(user: string): Promise<void> {
    await model().deleteMany({ user });
  }

  return { saveSentPrompt, getSentPrompt, deleteSentPromptsByUser };
}
