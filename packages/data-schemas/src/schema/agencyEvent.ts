import { Schema } from 'mongoose';
import { AGENCY_TEXT_MAX, AGENCY_EVENT_TYPES } from 'librechat-data-provider';
import type { IAgencyEvent } from '~/types/agency';

const AgencyEventSchema: Schema<IAgencyEvent> = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: AGENCY_EVENT_TYPES, required: true },
  conversationId: { type: String },
  messageId: { type: String },
  /** The chosen option's label, a goal check's outcome, a goal as it was set (masked), or a
   *  label or record id. Long enough for a goal (`AGENCY_TEXT_MAX`). */
  detail: { type: String, maxlength: AGENCY_TEXT_MAX },
  createdAt: { type: Date, default: Date.now },
  tenantId: { type: String, index: true },
});

AgencyEventSchema.index({ userId: 1, createdAt: -1 });
/** The recap's support and journey reads, by type over a period. */
AgencyEventSchema.index({ userId: 1, type: 1, createdAt: -1 });
/** A conversation's events, and its latest topic label. */
AgencyEventSchema.index({ userId: 1, conversationId: 1, type: 1, createdAt: -1 });

export default AgencyEventSchema;
