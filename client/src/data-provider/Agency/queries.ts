/* Learner agency */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import type {
  RecapRange,
  TAgencyRecap,
  TConversationGoal,
  TAgencyIntentions,
  TAgencyReflection,
  TClientAgencyEvent,
  TAgencyIntentionsInput,
  TAgencyReflectionInput,
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

export type UpdateConversationGoalParams = {
  conversationId: string;
  text: string;
  /** The suggested goal it started from; null drops it, undefined leaves it as it is. */
  suggestionId?: string | null;
};

export const useUpdateConversationGoalMutation = (
  options?: UseMutationOptions<{ goal: TConversationGoal }, Error, UpdateConversationGoalParams>,
) => {
  const queryClient = useQueryClient();
  return useMutation<{ goal: TConversationGoal }, Error, UpdateConversationGoalParams>(
    [MutationKeys.updateAgencyGoal],
    ({ conversationId, text, suggestionId }) =>
      dataService.updateConversationGoal(conversationId, {
        text,
        ...(suggestionId !== undefined ? { suggestionId } : {}),
      }),
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
  params: { conversationId?: string; range?: RecapRange } = {},
  config?: UseQueryOptions<TAgencyRecap>,
): QueryObserverResult<TAgencyRecap> =>
  useQuery<TAgencyRecap>(
    [QueryKeys.agencyRecap, params.conversationId ?? null, params.range ?? '7d'],
    () => dataService.getAgencyRecap(params),
    { refetchOnWindowFocus: false, keepPreviousData: true, ...config },
  );

export const useAgencyReflectionsQuery = (
  config?: UseQueryOptions<{ reflections: TAgencyReflection[] }>,
): QueryObserverResult<{ reflections: TAgencyReflection[] }> =>
  useQuery<{ reflections: TAgencyReflection[] }>(
    [QueryKeys.agencyReflections],
    () => dataService.getAgencyReflections(),
    { refetchOnWindowFocus: false, ...config },
  );

/** After a reflection is saved or edited, the list and the recap are read again. */
const useReflectionsChanged = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries([QueryKeys.agencyReflections]);
    queryClient.invalidateQueries([QueryKeys.agencyRecap]);
  };
};

export const useCreateAgencyReflectionMutation = (
  options?: UseMutationOptions<{ reflection: TAgencyReflection }, Error, TAgencyReflectionInput>,
) => {
  const changed = useReflectionsChanged();
  return useMutation<{ reflection: TAgencyReflection }, Error, TAgencyReflectionInput>(
    [MutationKeys.createAgencyReflection],
    (reflection) => dataService.createAgencyReflection(reflection),
    {
      ...options,
      onSuccess: (...args) => {
        changed();
        options?.onSuccess?.(...args);
      },
    },
  );
};

export type UpdateAgencyReflectionParams = {
  reflectionId: string;
  reflection: TAgencyReflectionInput;
};

export const useUpdateAgencyReflectionMutation = (
  options?: UseMutationOptions<
    { reflection: TAgencyReflection },
    Error,
    UpdateAgencyReflectionParams
  >,
) => {
  const changed = useReflectionsChanged();
  return useMutation<{ reflection: TAgencyReflection }, Error, UpdateAgencyReflectionParams>(
    [MutationKeys.updateAgencyReflection],
    ({ reflectionId, reflection }) => dataService.updateAgencyReflection(reflectionId, reflection),
    {
      ...options,
      onSuccess: (...args) => {
        changed();
        options?.onSuccess?.(...args);
      },
    },
  );
};

/** Reports an engagement only the browser sees; a failure is not the learner's concern. */
export const recordAgencyEvent = (event: TClientAgencyEvent): void => {
  dataService.recordAgencyEvent(event).catch(() => undefined);
};
