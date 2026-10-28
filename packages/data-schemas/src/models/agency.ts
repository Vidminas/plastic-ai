import type { Model } from 'mongoose';
import type {
  IAgencyGoal,
  IAgencyEvent,
  IAgencyPrompt,
  IAgencyIntentions,
  IAgencyReflection,
  IAgencyPromptRevision,
} from '~/types/agency';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agencyPromptRevisionSchema from '~/schema/agencyPromptRevision';
import agencyIntentionsSchema from '~/schema/agencyIntentions';
import agencyReflectionSchema from '~/schema/agencyReflection';
import agencyPromptSchema from '~/schema/agencyPrompt';
import agencyEventSchema from '~/schema/agencyEvent';
import agencyGoalSchema from '~/schema/agencyGoal';

export function createAgencyIntentionsModel(
  mongoose: typeof import('mongoose'),
): Model<IAgencyIntentions> {
  applyTenantIsolation(agencyIntentionsSchema);
  return (
    mongoose.models.AgencyIntentions ||
    mongoose.model<IAgencyIntentions>('AgencyIntentions', agencyIntentionsSchema)
  );
}

export function createAgencyGoalModel(mongoose: typeof import('mongoose')): Model<IAgencyGoal> {
  applyTenantIsolation(agencyGoalSchema);
  return mongoose.models.AgencyGoal || mongoose.model<IAgencyGoal>('AgencyGoal', agencyGoalSchema);
}

export function createAgencyEventModel(mongoose: typeof import('mongoose')): Model<IAgencyEvent> {
  applyTenantIsolation(agencyEventSchema);
  return (
    mongoose.models.AgencyEvent || mongoose.model<IAgencyEvent>('AgencyEvent', agencyEventSchema)
  );
}

export function createAgencyReflectionModel(
  mongoose: typeof import('mongoose'),
): Model<IAgencyReflection> {
  applyTenantIsolation(agencyReflectionSchema);
  return (
    mongoose.models.AgencyReflection ||
    mongoose.model<IAgencyReflection>('AgencyReflection', agencyReflectionSchema)
  );
}

export function createAgencyPromptModel(mongoose: typeof import('mongoose')): Model<IAgencyPrompt> {
  applyTenantIsolation(agencyPromptSchema);
  return (
    mongoose.models.AgencyPrompt ||
    mongoose.model<IAgencyPrompt>('AgencyPrompt', agencyPromptSchema)
  );
}

export function createAgencyPromptRevisionModel(
  mongoose: typeof import('mongoose'),
): Model<IAgencyPromptRevision> {
  applyTenantIsolation(agencyPromptRevisionSchema);
  return (
    mongoose.models.AgencyPromptRevision ||
    mongoose.model<IAgencyPromptRevision>('AgencyPromptRevision', agencyPromptRevisionSchema)
  );
}
