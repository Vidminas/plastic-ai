import { Schema } from 'mongoose';
import { AGENCY_PROMPT_MAX } from 'librechat-data-provider';
import type { IAgencyPromptRevision } from '~/types/agency';

/**
 * Every change a learner made to their hidden instructions, for the study: the masked template
 * they saved, or null where they reset it to the default. Never updated, only added to.
 */
const AgencyPromptRevisionSchema: Schema<IAgencyPromptRevision> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    template: { type: String, default: null, maxlength: AGENCY_PROMPT_MAX },
    tenantId: { type: String, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AgencyPromptRevisionSchema.index({ userId: 1, createdAt: 1 });

export default AgencyPromptRevisionSchema;
