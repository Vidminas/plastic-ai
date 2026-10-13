import { Schema } from 'mongoose';
import { AGENCY_EVENT_TYPES } from 'librechat-data-provider';
import type { IAgencyEvent } from '~/types/agency';

const AgencyEventSchema: Schema<IAgencyEvent> = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: AGENCY_EVENT_TYPES, required: true },
  conversationId: { type: String },
  messageId: { type: String },
  /** The chosen option's label, or a goal check's outcome. */
  detail: { type: String, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
  tenantId: { type: String, index: true },
});

AgencyEventSchema.index({ userId: 1, createdAt: -1 });
AgencyEventSchema.index({ userId: 1, conversationId: 1 });

export default AgencyEventSchema;
