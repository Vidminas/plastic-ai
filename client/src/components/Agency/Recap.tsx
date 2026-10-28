import { useEffect, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { Compass, ListChecks, MessageSquareMore, Target } from 'lucide-react';
import type { TAgencyEvent, TAgencyRecap, GoalCheckOutcome } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks';
import { recordAgencyEvent, useAgencyRecapQuery, useGetStartupConfig } from '~/data-provider';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import { useDocumentTitle, useLocalize } from '~/hooks';
import { trackAction } from '~/lib/rum/actions';
import { messageLink } from './links';

const OUTCOME_KEYS: Record<GoalCheckOutcome, TranslationKeys> = {
  continue: 'com_agency_outcome_continue',
  refocus: 'com_agency_outcome_refocus',
  goal_changed: 'com_agency_outcome_goal_changed',
};

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`border-border-light bg-surface-primary min-w-0 rounded-xl border p-5 ${className}`}
    >
      {children}
    </section>
  );
}

function Stat({
  icon,
  value,
  total,
  label,
  note,
}: {
  icon: ReactNode;
  value: number;
  total?: number;
  label: string;
  note: string;
}) {
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          className="bg-surface-tertiary text-text-secondary rounded-lg p-2.5"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div>
          <p className="text-text-primary text-2xl font-semibold tabular-nums">
            {value}
            {total != null && (
              <span className="text-text-tertiary text-base font-normal"> / {total}</span>
            )}
          </p>
          <p className="text-text-primary text-sm">{label}</p>
        </div>
      </div>
      <p className="text-text-secondary text-xs">{note}</p>
    </Panel>
  );
}

function Example({
  icon,
  title,
  example,
  describe,
  emptyKey,
}: {
  icon: ReactNode;
  title: string;
  example?: TAgencyEvent;
  describe: (example: TAgencyEvent) => string;
  emptyKey: TranslationKeys;
}) {
  const localize = useLocalize();
  const href = example?.conversationId
    ? messageLink(example.conversationId, example.messageId)
    : null;
  return (
    <li className="border-border-light flex items-center gap-4 border-t py-3 first:border-t-0">
      <span className="bg-surface-tertiary text-text-secondary rounded-lg p-2" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-sm font-medium">{title}</p>
        <p className="text-text-secondary truncate text-sm">
          {example ? describe(example) : localize(emptyKey)}
        </p>
      </div>
      {href != null ? (
        <Button asChild variant="outline" size="sm">
          <Link to={href}>{localize('com_agency_view_in_chat')}</Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled>
          {localize('com_agency_view_in_chat')}
        </Button>
      )}
    </li>
  );
}

/**
 * How a learner has used the agency features: goals set, options chosen, goal checks and
 * how they were resolved, and the latest example of each to open in the chat.
 */
export default function AgencyRecap() {
  const localize = useLocalize();
  const isSmallScreen = useDrawerViewport();
  const { data: startupConfig, isLoading: configLoading } = useGetStartupConfig();
  const enabled = startupConfig?.agency?.recap === true;
  const recap = useAgencyRecapQuery(undefined, { enabled });
  const viewed = useRef(false);

  useDocumentTitle(`${localize('com_agency_recap_title')} | LibreChat`);

  useEffect(() => {
    if (enabled && recap.isSuccess && !viewed.current) {
      viewed.current = true;
      recordAgencyEvent({ type: 'recap_viewed' });
      trackAction('agency.recap_viewed');
    }
  }, [enabled, recap.isSuccess]);

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
  const { goals, options, goalChecks, examples } = data ?? ({} as Partial<TAgencyRecap>);

  return (
    <div className="bg-surface-primary-alt text-text-primary h-full w-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {isSmallScreen && <OpenSidebar />}
            <div>
              <h1 className="text-2xl font-semibold">{localize('com_agency_recap_title')}</h1>
              <p className="text-text-secondary text-sm">{localize('com_agency_recap_intro')}</p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link to="/c/new">{localize('com_agency_return_to_chat')}</Link>
          </Button>
        </header>

        {recap.isError || data == null ? (
          <Panel>
            <p role="alert" className="text-text-destructive text-sm">
              {localize('com_agency_recap_error')}
            </p>
          </Panel>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Stat
                icon={<Target className="size-5" />}
                value={goals?.set ?? 0}
                total={goals?.conversations ?? 0}
                label={localize('com_agency_stat_goals')}
                note={localize('com_agency_stat_goals_note')}
              />
              <Stat
                icon={<ListChecks className="size-5" />}
                value={options?.selected ?? 0}
                total={options?.offered ?? 0}
                label={localize('com_agency_stat_options')}
                note={localize('com_agency_stat_options_note')}
              />
              <Stat
                icon={<Compass className="size-5" />}
                value={goalChecks?.offered ?? 0}
                label={localize('com_agency_stat_checks')}
                note={localize('com_agency_stat_checks_note', {
                  continue: goalChecks?.continue ?? 0,
                  refocus: goalChecks?.refocus ?? 0,
                  changed: goalChecks?.goal_changed ?? 0,
                })}
              />
            </div>

            <Panel>
              <p className="text-text-secondary text-xs font-medium tracking-wide uppercase">
                {localize('com_agency_in_context')}
              </p>
              <h2 className="text-text-primary mb-2 text-lg font-medium">
                {localize('com_agency_recent_examples')}
              </h2>
              <ul>
                <Example
                  icon={<Target className="size-4" />}
                  title={localize('com_agency_example_goal')}
                  example={examples?.goal}
                  describe={(example) => example.detail ?? ''}
                  emptyKey="com_agency_example_goal_empty"
                />
                <Example
                  icon={<ListChecks className="size-4" />}
                  title={localize('com_agency_example_option')}
                  example={examples?.option}
                  describe={(example) => example.detail ?? ''}
                  emptyKey="com_agency_example_option_empty"
                />
                <Example
                  icon={<MessageSquareMore className="size-4" />}
                  title={localize('com_agency_example_check')}
                  example={examples?.goalCheck}
                  describe={(example) =>
                    example.detail != null && example.detail in OUTCOME_KEYS
                      ? localize(OUTCOME_KEYS[example.detail as GoalCheckOutcome])
                      : ''
                  }
                  emptyKey="com_agency_example_check_empty"
                />
              </ul>
            </Panel>

          </>
        )}
      </div>
    </div>
  );
}
