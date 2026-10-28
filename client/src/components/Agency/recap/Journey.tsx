import { useId } from 'react';
import { useSetAtom } from 'jotai';
import { Link } from 'react-router-dom';
import { Button } from '@librechat/client';
import { Flag, Route, PenLine, Shuffle, ArrowRight, NotebookPen, CornerUpLeft } from 'lucide-react';
import type { GoalCheckOutcome, TAgencyJourneyItem, TAgencyRecap } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import type { Tone } from './Panel';
import Panel, { PanelHeading, ToneIcon } from './Panel';
import { reflectionDialogAtom } from '~/store/agency';
import { messageLink } from '../links';
import { useLocalize } from '~/hooks';

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

const ICONS = {
  goal_set: Flag,
  goal_updated: PenLine,
  reflection: NotebookPen,
} as const;

/** A goal check by how it was answered: carried on, back to the goal, or the goal changed. */
const CHECK_ICONS: Record<GoalCheckOutcome, typeof Flag> = {
  continue: ArrowRight,
  refocus: CornerUpLeft,
  goal_changed: Shuffle,
};

/** Goals in orange and amber, goal checks in pink, reflections in teal. */
const TONE: Record<TAgencyJourneyItem['type'], Tone> = {
  goal_set: 'orange',
  goal_updated: 'amber',
  goal_check: 'pink',
  reflection: 'teal',
};

const CHECK_KEYS: Record<GoalCheckOutcome, TranslationKeys> = {
  continue: 'com_agency_journey_check_continue',
  refocus: 'com_agency_journey_check_refocus',
  goal_changed: 'com_agency_journey_check_goal_changed',
};

function useDescribe() {
  const localize = useLocalize();
  return (item: TAgencyJourneyItem): string => {
    switch (item.type) {
      case 'goal_set':
        return localize('com_agency_journey_set', { 0: item.goal?.text ?? '' });
      case 'goal_updated':
        return localize('com_agency_journey_updated', { 0: item.goal?.text ?? '' });
      case 'goal_check':
        return localize(CHECK_KEYS[item.outcome ?? 'continue']);
      case 'reflection':
        return item.about
          ? localize('com_agency_journey_reflection', { 0: item.about })
          : localize('com_agency_journey_reflection_untitled');
      default:
        return '';
    }
  };
}

/**
 * How the learner's conversation goals have changed, newest first: goals set and changed, the
 * goal checks and how they were answered, and reflections, each linked to its moment in the
 * chat or to the reflection.
 */
export default function Journey({ recap }: { recap: TAgencyRecap }) {
  const localize = useLocalize();
  const headingId = useId();
  const describe = useDescribe();
  const openReflection = useSetAtom(reflectionDialogAtom);
  return (
    <Panel>
      <PanelHeading
        id={headingId}
        icon={Route}
        tone="pink"
        title={localize('com_agency_journey_title')}
      />
      <p className="text-text-secondary -mt-2 mb-3 text-sm">
        {localize('com_agency_journey_help')}
      </p>
      {recap.journey.length === 0 ? (
        <p className="text-text-secondary text-sm">{localize('com_agency_journey_empty')}</p>
      ) : (
        <ol
          aria-labelledby={headingId}
          className="border-border-light ms-3.5 border-s-2 border-dashed"
        >
          {recap.journey.map((item, i) => {
            const Icon =
              item.type === 'goal_check'
                ? CHECK_ICONS[item.outcome ?? 'continue']
                : ICONS[item.type];
            const href = item.conversationId
              ? messageLink(item.conversationId, item.messageId)
              : null;
            return (
              <li key={`${item.at}-${i}`} className="relative flex items-start gap-3 py-2 ps-6">
                {/* Centred on the dashed line: the chip is 1.625rem across and the line 2px. */}
                <span className="bg-surface-primary absolute -start-3.5 top-1.5 flex rounded-full">
                  <ToneIcon
                    icon={Icon}
                    tone={TONE[item.type]}
                    className="rounded-full p-1.5"
                    size="size-3.5"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-sm">{describe(item)}</p>
                  <p className="text-text-secondary text-xs">
                    <time dateTime={item.at}>{when.format(new Date(item.at))}</time>
                  </p>
                </div>
                {href != null && (
                  <Button asChild variant="ghost" size="sm">
                    <Link to={href}>{localize('com_agency_view_in_chat')}</Link>
                  </Button>
                )}
                {item.reflectionId != null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openReflection({ reflectionId: item.reflectionId })}
                  >
                    {localize('com_agency_reflection_open')}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
