import { useEffect, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import { Lock, Sprout } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { RECAP_RANGES } from 'librechat-data-provider';
import type { RecapRange } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { recordAgencyEvent, useAgencyRecapQuery, useGetStartupConfig } from '~/data-provider';
import { settingsInitialTabAtom, settingsOpenAtom } from '~/components/Nav/Settings';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { trackAction } from '~/lib/rum/actions';
import Panel, { ToneIcon } from './recap/Panel';
import TopicShares from './recap/TopicShares';
import Reflections from './recap/Reflections';
import { topicSeries } from './recap/topics';
import Takeaways from './recap/Takeaways';
import GoalsUsage from './recap/Goals';
import Signals from './recap/Signals';
import Journey from './recap/Journey';
import Support from './recap/Support';

const RANGE_KEYS: Record<RecapRange, TranslationKeys> = {
  '7d': 'com_agency_range_7d',
  '30d': 'com_agency_range_30d',
  all: 'com_agency_range_all',
};

/** Where the learner can see, change or delete what is kept. */
function YourData() {
  const localize = useLocalize();
  const openSettings = useSetAtom(settingsOpenAtom);
  const setTab = useSetAtom(settingsInitialTabAtom);
  return (
    <Panel className="flex items-start gap-3">
      <ToneIcon icon={Lock} tone="teal" />
      <div className="min-w-0 flex-1">
        <h2 className="text-text-primary text-sm font-medium">
          {localize('com_agency_data_title')}
        </h2>
        <p className="text-text-secondary text-sm">{localize('com_agency_data_help')}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setTab('data');
          openSettings(true);
        }}
      >
        {localize('com_agency_data_open')}
      </Button>
    </Panel>
  );
}

/**
 * The learner's journey over a period: what their conversation goals were and how they
 * changed, with links back to those moments in the chats, the topics they worked on, the kinds
 * of help they asked for, what is worth noticing, and their long-term intentions. It shows
 * what the AI was used for, not how much: no message totals or volume charts, which would
 * suggest that more use is better.
 */
export default function AgencyRecap() {
  const localize = useLocalize();
  const isSmallScreen = useDrawerViewport();
  const { data: startupConfig, isLoading: configLoading } = useGetStartupConfig();
  const enabled = startupConfig?.agency?.recap === true;
  const [range, setRange] = useState<RecapRange>('7d');
  const recap = useAgencyRecapQuery({ range }, { enabled });
  const viewed = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loaded = !configLoading && enabled && !recap.isLoading;

  useDocumentTitle(`${localize('com_agency_recap_title')} | LibreChat`);

  useEffect(() => {
    if (enabled && recap.isSuccess && !viewed.current) {
      viewed.current = true;
      recordAgencyEvent({ type: 'recap_viewed' });
      trackAction('agency.recap_viewed');
    }
  }, [enabled, recap.isSuccess]);

  /** Opened from the sidebar, the page takes the focus, as a panel the sidebar opens does. */
  useEffect(() => {
    if (loaded) {
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [loaded]);

  if (configLoading || (enabled && recap.isLoading)) {
    return (
      <div
        className="bg-surface-primary-alt flex h-full w-full items-center justify-center"
        role="status"
      >
        <Spinner aria-label={localize('com_ui_loading')} />
      </div>
    );
  }
  if (!enabled) {
    return <Navigate to="/c/new" replace />;
  }

  const data = recap.data;
  const classifierTopics = startupConfig?.agency?.classifier?.topics;
  const classified = classifierTopics != null;
  const series = topicSeries(classifierTopics ?? [], {
    other: localize('com_agency_topic_other'),
    unclassified: localize('com_agency_topic_unclassified'),
  });
  const signals = startupConfig?.agency?.classifier?.signals ?? [];
  const goalsOn = startupConfig?.agency?.conversationGoal === true;
  const reflectionsOn = startupConfig?.agency?.reflections === true;

  return (
    <div className="bg-surface-primary-alt text-text-primary h-full w-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="rounded-theme-surface border-border-light from-series-4/15 via-series-2/10 to-series-5/10 flex flex-wrap items-start justify-between gap-3 border bg-linear-to-br p-5">
          <div className="flex min-w-0 items-start gap-3">
            {isSmallScreen && <OpenSidebar />}
            <ToneIcon icon={Sprout} tone="orange" className="rounded-xl p-2.5" size="size-6" />
            <div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-semibold focus:outline-none"
              >
                {localize('com_agency_recap_title')}
              </h1>
              <p className="text-text-secondary text-sm">{localize('com_agency_recap_intro')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={localize('com_agency_range_label')}
              className="border-border-light bg-surface-primary flex rounded-lg border p-0.5"
            >
              {RECAP_RANGES.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={range === option ? 'secondary' : 'ghost'}
                  aria-pressed={range === option}
                  onClick={() => {
                    setRange(option);
                    trackAction('agency.recap_range', { range: option });
                  }}
                >
                  {localize(RANGE_KEYS[option])}
                </Button>
              ))}
            </div>
            <Button asChild variant="outline">
              <Link to="/c/new">{localize('com_agency_return_to_chat')}</Link>
            </Button>
          </div>
        </header>

        {recap.isError || data == null ? (
          <Panel>
            <p role="alert" className="text-text-destructive text-sm">
              {localize('com_agency_recap_error')}
            </p>
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="flex flex-col gap-4 lg:col-span-2">
                {goalsOn && (
                  <GoalsUsage
                    recap={data}
                    series={series}
                    classified={classified}
                    signals={signals}
                  />
                )}
                {classified && <Signals recap={data} signals={signals} />}
                <Journey recap={data} />
              </div>
              <div className="flex flex-col gap-4">
                <Takeaways recap={data} series={series} />
                {classified && <TopicShares recap={data} series={series} />}
                {classified && <Support recap={data} />}
                {reflectionsOn && <Reflections recap={data} />}
              </div>
            </div>

            <YourData />
          </>
        )}
      </div>
    </div>
  );
}
