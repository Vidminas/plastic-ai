import { Schema } from 'mongoose';
import { AGENCY_PROMPT_MAX } from 'librechat-data-provider';
import type { IAgencyPrompt } from '~/types/agency';

/** A learner's own prompt template, masked; no document means the default applies. */
const AgencyPromptSchema: Schema<IAgencyPrompt> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    /** Empty when the learner chose to send their messages on their own. */
    template: { type: String, default: '', maxlength: AGENCY_PROMPT_MAX },
    tenantId: { type: String, index: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export default AgencyPromptSchema;
