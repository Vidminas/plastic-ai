import { Schema } from 'mongoose';
import { SENT_PROMPT_TEXT_MAX } from 'librechat-data-provider';
import type { ISentPrompt } from '~/types/sentPrompt';

/**
 * Everything the model got on one turn, kept beside the user's message rather than on it, so
 * shared links and exports never carry it. Deleted with its conversation or its user.
 */
const SentPromptSchema: Schema<ISentPrompt> = new Schema(
  {
    user: { type: String, required: true },
    conversationId: { type: String, required: true },
    messageId: { type: String, required: true },
    system: { type: String, default: '', maxlength: SENT_PROMPT_TEXT_MAX },
    message: { type: String, default: '', maxlength: SENT_PROMPT_TEXT_MAX },
    historyCount: { type: Number, default: 0 },
    tools: { type: [String], default: [] },
    truncated: { type: Boolean, default: false },
    tenantId: { type: String, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

SentPromptSchema.index({ user: 1, messageId: 1 }, { unique: true });
SentPromptSchema.index({ user: 1, conversationId: 1 });

export default SentPromptSchema;
