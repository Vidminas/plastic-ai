import type { Model } from 'mongoose';
import type { IAgencyEvent, IAgencyGoal, IAgencyIntentions } from '~/types/agency';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import agencyIntentionsSchema from '~/schema/agencyIntentions';
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
