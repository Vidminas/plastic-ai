import type {
  AgencyFactor,
  AgencyEventType,
  TAgencyReflectionAnswers,
} from 'librechat-data-provider';
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

/** A reflection a learner wrote: their answers to the reflection's questions. */
export interface IAgencyReflection extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  answers: TAgencyReflectionAnswers;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
}

/** A learner's own hidden instructions. */
export interface IAgencyPrompt extends Document {
  userId: Types.ObjectId;
  template: string;
  updatedAt?: Date;
  tenantId?: string;
}

/** One change to a learner's hidden instructions; `template: null` is a reset. */
export interface IAgencyPromptRevision extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  template: string | null;
  createdAt: Date;
  tenantId?: string;
}

/** One engagement with an agency feature, for the recap page. */
export interface IAgencyEvent extends Document {
  userId: Types.ObjectId;
  type: AgencyEventType;
  conversationId?: string;
  messageId?: string;
  detail?: string;
  classifierVersion?: string;
  createdAt: Date;
  tenantId?: string;
}

export interface RecordAgencyEventParams {
  userId: string | Types.ObjectId;
  type: AgencyEventType;
  conversationId?: string;
  messageId?: string;
  detail?: string;
  classifierVersion?: string;
}
