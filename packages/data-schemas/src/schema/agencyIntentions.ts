import { Schema } from 'mongoose';
import { AGENCY_FACTORS, AGENCY_TEXT_MAX } from 'librechat-data-provider';
import type { IAgencyIntentions } from '~/types/agency';

const importance = { type: Number, min: 1, max: 5 };

const AgencyIntentionsSchema: Schema<IAgencyIntentions> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    goals: { type: String, default: '', maxlength: AGENCY_TEXT_MAX },
    intendedUse: { type: String, default: '', maxlength: AGENCY_TEXT_MAX },
    commitments: { type: String, default: '', maxlength: AGENCY_TEXT_MAX },
    factors: {
      type: new Schema(Object.fromEntries(AGENCY_FACTORS.map((factor) => [factor, importance])), {
        _id: false,
      }),
      default: {},
    },
    tenantId: { type: String, index: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export default AgencyIntentionsSchema;
