import React from 'react';
import { dataService } from 'librechat-data-provider';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTagConversationMutation } from '../mutations';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getConversationTags: jest.fn(),
      addTagToConversation: jest.fn(),
    },
  };
});

const getConversationTags = dataService.getConversationTags as jest.MockedFunction<
  typeof dataService.getConversationTags
>;
const addTagToConversation = dataService.addTagToConversation as jest.MockedFunction<
  typeof dataService.addTagToConversation
>;

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

describe('useTagConversationMutation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConversationTags.mockResolvedValue([]);
    addTagToConversation.mockResolvedValue(['work']);
  });

  /** It mounts with the conversation menu whether or not bookmarks are offered, and the tags
   *  route answers 403 without the bookmark permission. */
  it('does not request the tags until a tag is saved', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useTagConversationMutation('convo-1'), {
      wrapper: createWrapper(queryClient),
    });
    expect(getConversationTags).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.mutateAsync({ tags: ['work'], tag: 'work' });
    });
    expect(getConversationTags).toHaveBeenCalledTimes(1);
  });
});
