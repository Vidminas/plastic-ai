import React from 'react';
import { createStore, Provider } from 'jotai';
import { renderHook } from '@testing-library/react';
import type { TEndpointsConfig } from 'librechat-data-provider';
import { showFilesDialogAtom } from '~/store/filesDialog';
import useSideNavLinks from '../useSideNavLinks';

jest.mock('~/hooks', () => ({
  useHasAccess: () => false,
  useMCPServerManager: () => ({ availableMCPServers: [] }),
  useGetAgentsConfig: () => ({ agentsConfig: undefined }),
  useAgentCapabilities: () => ({ skillsEnabled: false }),
}));
jest.mock('~/components/SidePanel/MCPBuilder/MCPBuilderPanel', () => () => null);
jest.mock('~/components/SidePanel/Agents/AgentPanelSwitch', () => () => null);
jest.mock('~/components/SidePanel/Bookmarks/BookmarkPanel', () => () => null);
jest.mock('~/components/SidePanel/Builder/PanelSwitch', () => () => null);
jest.mock('~/components/SidePanel/Schedules', () => ({ SchedulePanel: () => null }));
jest.mock('~/components/SidePanel/Parameters/Panel', () => () => null);
jest.mock('~/components/SidePanel/Memories', () => ({ MemoryPanel: () => null }));
jest.mock('~/components/Prompts', () => ({ PromptsAccordion: () => null }));
jest.mock('~/components/Skills', () => ({ SkillsAccordion: () => null }));

describe('useSideNavLinks', () => {
  it('offers My Files in the sidebar, opening the file manager dialog', () => {
    const store = createStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );
    const { result } = renderHook(
      () =>
        useSideNavLinks({
          keyProvided: true,
          interfaceConfig: {},
          endpointsConfig: {} as TEndpointsConfig,
          includeHidePanel: false,
        }),
      { wrapper },
    );

    const files = result.current.find((link) => link.id === 'files');
    expect(files).toMatchObject({ title: 'com_nav_my_files' });
    expect(files?.Component).toBeUndefined();

    expect(store.get(showFilesDialogAtom)).toBe(false);
    files?.onClick?.();
    expect(store.get(showFilesDialogAtom)).toBe(true);
  });
});
