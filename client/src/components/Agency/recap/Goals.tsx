import { useId } from 'react';
import { Target } from 'lucide-react';
import { AGENCY_OWN_GOAL } from 'librechat-data-provider';
import type { TAgencyRecap, TGoalSuggestion } from 'librechat-data-provider';
import type { TopicSeries } from './topics';
import { GoalIcon, useGoalSuggestions } from '../goals';
import { SUPPORT_KEYS, rankSupport } from './labels';
import Panel, { PanelHeading } from './Panel';
import { rankTopics } from './topics';
import { useLocalize } from '~/hooks';

/** A goal group's name: its suggestion's title, or "Goals in your own words". */
export function useGoalName() {
  const localize = useLocalize();
  const suggestions = useGoalSuggestions();
  return (goal: string): string =>
    goal === AGENCY_OWN_GOAL
      ? localize('com_agency_goals_usage_own')
      : (suggestions.find((suggestion: TGoalSuggestion) => suggestion.id === goal)?.title ??
        localize('com_agency_goals_usage_own'));
}

/**
 * How the period's chats map onto the learner's conversation goals, grouped by the suggested
 * goal each started from, with goals in their own words and chats without a goal after them:
 * each group's share of the chats, its main topics and the kinds of help asked for.
 */
export default function GoalsUsage({
  recap,
  series,
  classified,
}: {
  recap: TAgencyRecap;
  series: TopicSeries[];
  classified: boolean;
}) {
  const localize = useLocalize();
  const headingId = useId();
  const suggestions = useGoalSuggestions();
  const nameOf = useGoalName();
  const rows = recap.goalUsage;
  const total = Math.max(1, recap.chats);
  const share = (chats: number) => `${Math.round((chats / total) * 100)}%`;
  return (
    <Panel>
      <PanelHeading
        id={headingId}
        icon={Target}
        tone="orange"
        title={localize('com_agency_goals_usage_title')}
      />
      <p className="text-text-secondary -mt-2 mb-3 text-sm">
        {localize('com_agency_goals_usage_help')}
      </p>
      {rows.length === 0 && recap.noGoal.conversations === 0 ? (
        <p className="text-text-secondary text-sm">{localize('com_agency_goals_usage_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby={headingId} className="w-full text-left text-sm">
            <thead className="text-text-secondary text-xs">
              <tr>
                <th scope="col" className="py-2 pe-3 font-medium">
                  {localize('com_agency_goals_usage_goal')}
                </th>
                <th scope="col" className="py-2 pe-3 font-medium">
                  {localize('com_agency_goals_usage_share')}
                </th>
                {classified && (
                  <>
                    <th scope="col" className="py-2 pe-3 font-medium">
                      {localize('com_agency_goals_usage_topics')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {localize('com_agency_goals_usage_support')}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.goal} className="border-border-light border-t">
                  <th scope="row" className="py-2.5 pe-3 font-normal">
                    <span className="flex items-center gap-2">
                      <span
                        className="bg-series-2/15 text-series-2 rounded-md p-1"
                        aria-hidden="true"
                      >
                        <GoalIcon
                          suggestionId={row.goal === AGENCY_OWN_GOAL ? undefined : row.goal}
                          suggestions={suggestions}
                        />
                      </span>
                      <span className="text-text-primary">{nameOf(row.goal)}</span>
                    </span>
                  </th>
                  <td className="py-2.5 pe-3 tabular-nums">{share(row.conversations)}</td>
                  {classified && (
                    <td className="py-2.5 pe-3">
                      <span className="flex flex-wrap gap-1">
                        {rankTopics(row.topics, series)
                          .slice(0, 2)
                          .map(({ topic }) => (
                            <span
                              key={topic.id}
                              className="bg-surface-tertiary text-text-secondary flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                            >
                              <span
                                className={`size-2 rounded-full ${topic.swatch}`}
                                aria-hidden="true"
                              />
                              {topic.label}
                            </span>
                          ))}
                      </span>
                    </td>
                  )}
                  {classified && (
                    <td className="py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {rankSupport(row.support)
                          .slice(0, 3)
                          .map(([type]) => (
                            <span
                              key={type}
                              className="bg-surface-tertiary text-text-secondary rounded-full px-2 py-0.5 text-xs"
                            >
                              {localize(SUPPORT_KEYS[type])}
                            </span>
                          ))}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
              <tr className="border-border-light text-text-secondary border-t">
                <th scope="row" className="py-2.5 pe-3 font-normal">
                  {localize('com_agency_goals_usage_none')}
                </th>
                <td className="py-2.5 pe-3 tabular-nums">{share(recap.noGoal.conversations)}</td>
                {classified && (
                  <>
                    <td />
                    <td />
                  </>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
