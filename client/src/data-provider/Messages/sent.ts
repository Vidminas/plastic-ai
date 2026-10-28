import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult } from '@tanstack/react-query';
import type { TSentPrompt } from 'librechat-data-provider';

/**
 * What a sent message sent the model, read again each time it is shown: the record is saved in
 * the background as the reply runs, and a regenerated reply replaces it.
 */
export const useSentPromptQuery = (
  conversationId: string | null | undefined,
  messageId: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): QueryObserverResult<{ sentPrompt: TSentPrompt }> =>
  useQuery<{ sentPrompt: TSentPrompt }>(
    [QueryKeys.sentPrompt, conversationId, messageId],
    () => dataService.getSentPrompt(conversationId as string, messageId as string),
    {
      enabled: enabled && !!conversationId && !!messageId,
      refetchOnMount: 'always',
      refetchOnWindowFocus: false,
      retry: false,
    },
  );
