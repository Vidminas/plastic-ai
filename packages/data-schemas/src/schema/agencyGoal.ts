import { Schema } from 'mongoose';
import { AGENCY_TEXT_MAX } from 'librechat-data-provider';
import type { IAgencyGoal } from '~/types/agency';

const AgencyGoalSchema: Schema<IAgencyGoal> = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversationId: { type: String, required: true },
  text: { type: String, required: true, maxlength: AGENCY_TEXT_MAX },
  /** The `agency.goalSuggestions` entry the goal started from, if any. */
  suggestionId: { type: String, maxlength: 64 },
  setAt: { type: Date, default: Date.now },
  tenantId: { type: String, index: true },
});

AgencyGoalSchema.index({ userId: 1, conversationId: 1 }, { unique: true });

export default AgencyGoalSchema;
