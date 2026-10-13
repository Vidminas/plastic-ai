/* Learner agency */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type {
  TAgencyRecap,
  TConversationGoal,
  TAgencyIntentions,
  TClientAgencyEvent,
  TAgencyIntentionsInput,
} from 'librechat-data-provider';
import type {
  UseQueryOptions,
  UseMutationOptions,
  QueryObserverResult,
} from '@tanstack/react-query';

type IntentionsResponse = { intentions: TAgencyIntentions | null };
type GoalResponse = { goal: TConversationGoal | null };

export const useAgencyIntentionsQuery = (
  config?: UseQueryOptions<IntentionsResponse>,
): QueryObserverResult<IntentionsResponse> =>
  useQuery<IntentionsResponse>(
    [QueryKeys.agencyIntentions],
    () => dataService.getAgencyIntentions(),
    { refetchOnWindowFocus: false, ...config },
  );

export const useUpdateAgencyIntentionsMutation = (
  options?: UseMutationOptions<{ intentions: TAgencyIntentions }, Error, TAgencyIntentionsInput>,
) => {
  const queryClient = useQueryClient();
  return useMutation<{ intentions: TAgencyIntentions }, Error, TAgencyIntentionsInput>(
    [MutationKeys.updateAgencyIntentions],
    (intentions) => dataService.updateAgencyIntentions(intentions),
    {
      ...options,
      onSuccess: (data, ...rest) => {
        queryClient.setQueryData<IntentionsResponse>([QueryKeys.agencyIntentions], data);
        queryClient.invalidateQueries([QueryKeys.agencyRecap]);
        options?.onSuccess?.(data, ...rest);
      },
    },
  );
};

export const useConversationGoalQuery = (
  conversationId: string | null | undefined,
  config?: UseQueryOptions<GoalResponse>,
): QueryObserverResult<GoalResponse> =>
  useQuery<GoalResponse>(
    [QueryKeys.agencyGoal, conversationId],
    () => dataService.getConversationGoal(conversationId as string),
    {
      refetchOnWindowFocus: false,
      ...config,
      enabled: !!conversationId && config?.enabled !== false,
    },
  );

export type UpdateConversationGoalParams = { conversationId: string; text: string };

export const useUpdateConversationGoalMutation = (
  options?: UseMutationOptions<{ goal: TConversationGoal }, Error, UpdateConversationGoalParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<{ goal: TConversationGoal }, Error, UpdateConversationGoalParams>(
    [MutationKeys.updateAgencyGoal],
    ({ conversationId, text }) => dataService.updateConversationGoal(conversationId, text),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.setQueryData<GoalResponse>(
          [QueryKeys.agencyGoal, variables.conversationId],
          data,
        );
        queryClient.invalidateQueries([QueryKeys.agencyRecap]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useAgencyRecapQuery = (
  conversationId?: string,
  config?: UseQueryOptions<TAgencyRecap>,
): QueryObserverResult<TAgencyRecap> =>
  useQuery<TAgencyRecap>(
    [QueryKeys.agencyRecap, conversationId ?? null],
    () => dataService.getAgencyRecap(conversationId),
    { refetchOnWindowFocus: false, ...config },
  );

/** Reports an engagement only the browser sees; a failure is not the learner's concern. */
export const recordAgencyEvent = (event: TClientAgencyEvent): void => {
  dataService.recordAgencyEvent(event).catch(() => undefined);
};
