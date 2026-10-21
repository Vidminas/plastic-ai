import type { AgencyEventType, AgencyFactor } from 'librechat-data-provider';
import type { Types, Document } from 'mongoose';

/** A learner's long-term intentions; never sent to a model. */
export interface IAgencyIntentions extends Document {
  userId: Types.ObjectId;
  goals: string;
  intendedUse: string;
  commitments: string;
  factors: Partial<Record<AgencyFactor, number>>;
  updatedAt?: Date;
  tenantId?: string;
}

/** The goal a learner set for one conversation. */
export interface IAgencyGoal extends Document {
  userId: Types.ObjectId;
  conversationId: string;
  text: string;
  /** The suggested goal it started from. */
  suggestionId?: string;
  setAt: Date;
  tenantId?: string;
}

/** One engagement with an agency feature, for the recap page. */
export interface IAgencyEvent extends Document {
  userId: Types.ObjectId;
  type: AgencyEventType;
  conversationId?: string;
  messageId?: string;
  detail?: string;
  createdAt: Date;
  tenantId?: string;
}

export interface RecordAgencyEventParams {
  userId: string | Types.ObjectId;
  type: AgencyEventType;
  conversationId?: string;
  messageId?: string;
  detail?: string;
}
