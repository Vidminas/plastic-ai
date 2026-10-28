import type { Model } from 'mongoose';
import type { ISentPrompt } from '~/types/sentPrompt';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import sentPromptSchema from '~/schema/sentPrompt';

export function createSentPromptModel(mongoose: typeof import('mongoose')): Model<ISentPrompt> {
  applyTenantIsolation(sentPromptSchema);
  return mongoose.models.SentPrompt || mongoose.model<ISentPrompt>('SentPrompt', sentPromptSchema);
}
