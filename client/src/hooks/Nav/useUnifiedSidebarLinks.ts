import { useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { useRecoilValue } from 'recoil';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import { getConfigDefaults, getEndpointField } from 'librechat-data-provider';
import { Sprout, Compass, BarChart3, NotebookPen, MessagesSquare } from 'lucide-react';
import type { TEndpointsConfig } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import { useGetEndpointsQuery, useGetStartupConfig, useInsightsAccessQuery } from '~/data-provider';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { reflectionDialogAtom, intentionsDialogAtom } from '~/store/agency';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import { useAuthContext } from '~/hooks';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

export default function useUnifiedSidebarLinks() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthContext();
  /** Selector instead of the full conversation atom: the links only depend on
   * the endpoint, so parameter edits and other conversation writes stay out. */
  const endpoint = useRecoilValue(store.conversationEndpointByIndex(0)) ?? undefined;
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );
  const insightsFeatureEnabled = startupConfig?.insightsEnabled === true;
  const isInsightsRoute = location.pathname.startsWith('/insights');
  const { data: insightsAccess, isLoading: isInsightsAccessLoading } = useInsightsAccessQuery(
    user?.id,
    {
      enabled: !!user && insightsFeatureEnabled && !isInsightsRoute,
    },
  );

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );

  const userProvidesKey = useMemo(
    () => !!(endpointsConfig?.[endpoint ?? '']?.userProvide ?? false),
    [endpointsConfig, endpoint],
  );

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint ?? '');

  const keyProvided = useMemo(
    () => (userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true),
    [keyExpiry.expiresAt, userProvidesKey],
  );

  const sideNavLinks = useSideNavLinks({
    keyProvided,
    endpoint,
    endpointType,
    interfaceConfig,
    endpointsConfig,
    includeHidePanel: false,
  });

  const links = useMemo(() => {
    const conversationLink: NavLink = {
      title: 'com_ui_chat_history',
      label: '',
      icon: MessagesSquare,
      id: 'conversations',
      Component: ConversationsSection,
    };

    if (
      !insightsFeatureEnabled ||
      (!isInsightsRoute && !isInsightsAccessLoading && insightsAccess?.access !== true)
    ) {
      return [conversationLink, ...sideNavLinks];
    }

    const insightsLink: NavLink = {
      title: 'com_insights_navigation',
      label: '',
      icon: BarChart3,
      id: 'insights',
      disabled: !isInsightsRoute && isInsightsAccessLoading,
      onClick: () => {
        if (!location.pathname.startsWith('/insights')) {
          navigate('/insights');
        }
      },
    };
    const mcpIndex = sideNavLinks.findIndex((link) => link.id === 'mcp-builder');
    const nextLinks = [...sideNavLinks];
    nextLinks.splice(mcpIndex >= 0 ? mcpIndex + 1 : nextLinks.length, 0, insightsLink);

    return [conversationLink, ...nextLinks];
  }, [
    insightsAccess?.access,
    insightsFeatureEnabled,
    isInsightsAccessLoading,
    isInsightsRoute,
    location.pathname,
    navigate,
    sideNavLinks,
  ]);

  /** The agency recap (`agency.recap`), a page of its own like Insights. */
  const agencyRecapEnabled = startupConfig?.agency?.recap === true;
  const withRecap = useMemo(() => {
    if (!agencyRecapEnabled) {
      return links;
    }
    const recapLink: NavLink = {
      title: 'com_agency_recap_navigation',
      label: '',
      icon: Sprout,
      id: 'agency-recap',
      onClick: () => {
        if (!location.pathname.startsWith('/agency')) {
          navigate('/agency');
        }
      },
    };
    return [...links, recapLink];
  }, [agencyRecapEnabled, links, location.pathname, navigate]);

  /** Long-term intentions (`agency.intentions`) open in a dialog over whatever page is showing. */
  const intentionsEnabled = startupConfig?.agency?.intentions === true;
  const openIntentions = useSetAtom(intentionsDialogAtom);
  const withIntentions = useMemo(() => {
    if (!intentionsEnabled) {
      return withRecap;
    }
    const intentionsLink: NavLink = {
      title: 'com_agency_intentions_navigation',
      label: '',
      icon: Compass,
      id: 'agency-intentions',
      onClick: () => openIntentions(true),
    };
    return [...withRecap, intentionsLink];
  }, [intentionsEnabled, openIntentions, withRecap]);

  /** Reflections (`agency.reflections`) open in a dialog over whatever page is showing. */
  const reflectionsEnabled = startupConfig?.agency?.reflections === true;
  const openReflections = useSetAtom(reflectionDialogAtom);
  const withReflections = useMemo(() => {
    if (!reflectionsEnabled) {
      return withIntentions;
    }
    const reflectLink: NavLink = {
      title: 'com_agency_reflections_navigation',
      label: '',
      icon: NotebookPen,
      id: 'agency-reflections',
      onClick: () => openReflections({}),
    };
    return [...withIntentions, reflectLink];
  }, [openReflections, reflectionsEnabled, withIntentions]);

  // return links;
  return withReflections;
}
