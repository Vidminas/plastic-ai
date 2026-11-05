import { Schema } from 'mongoose';
import { AGENCY_REFLECTION_QUESTIONS, AGENCY_TEXT_MAX } from 'librechat-data-provider';
import type { IAgencyReflection } from '~/types/agency';

const answer = { type: String, default: '', maxlength: AGENCY_TEXT_MAX };

const AgencyReflectionSchema: Schema<IAgencyReflection> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** One answer per question; a skipped question is empty. */
    answers: {
      type: new Schema(
        Object.fromEntries(AGENCY_REFLECTION_QUESTIONS.map((question) => [question, answer])),
        { _id: false },
      ),
      default: {},
    },
    tenantId: { type: String, index: true },
  },
  /** `createdAt` is when it was first saved; `updatedAt`, when it was last edited. */
  { timestamps: true },
);

AgencyReflectionSchema.index({ userId: 1, createdAt: -1 });

export default AgencyReflectionSchema;
