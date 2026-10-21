import type { Model } from 'mongoose';
import type {
  IAgencyGoal,
  IAgencyEvent,
  IAgencyIntentions,
  IAgencyReflection,
} from '~/types/agency';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agencyIntentionsSchema from '~/schema/agencyIntentions';
import agencyReflectionSchema from '~/schema/agencyReflection';
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
