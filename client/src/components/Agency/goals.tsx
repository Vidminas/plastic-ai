import { useId } from 'react';
import {
  Check,
  Clock,
  Globe,
  Heart,
  Users,
  Target,
  PenLine,
  Compass,
  BookOpen,
  Lightbulb,
  Footprints,
  Calculator,
  FlaskConical,
} from 'lucide-react';
import type { GoalSuggestionIcon, TGoalSuggestion } from 'librechat-data-provider';
import type { ComponentType } from 'react';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const ICONS: Record<GoalSuggestionIcon, ComponentType<{ className?: string }>> = {
  book: BookOpen,
  calculator: Calculator,
  clock: Clock,
  compass: Compass,
  flask: FlaskConical,
  globe: Globe,
  heart: Heart,
  lightbulb: Lightbulb,
  pen: PenLine,
  run: Footprints,
  target: Target,
  users: Users,
};

/** The goals the goal card suggests (`agency.goalSuggestions`); empty when there are none. */
export function useGoalSuggestions(): TGoalSuggestion[] {
  const { data } = useGetStartupConfig();
  return data?.agency?.goalSuggestions ?? [];
}

/** The suggestion whose title a goal starts with (alone or followed by a colon), if any. */
export function leadingSuggestion(
  text: string,
  suggestions: TGoalSuggestion[],
): TGoalSuggestion | undefined {
  const goal = text.trim();
  return suggestions.find(
    ({ title }) =>
      goal === title || (goal.startsWith(title) && goal.slice(title.length).startsWith(':')),
  );
}

/**
 * Joins a chosen suggestion's title and the learner's own words into the goal they set. Words
 * that already start with a suggestion's title, as a reopened goal does, lose that title first,
 * so picking a suggestion never stacks one title on another.
 */
export function composeGoal(
  title: string | undefined,
  details: string,
  suggestions: TGoalSuggestion[] = [],
): string {
  const leading = title ? leadingSuggestion(details, suggestions) : undefined;
  const own = (
    leading ? details.trim().slice(leading.title.length).replace(/^:/, '') : details
  ).trim();
  if (!title) {
    return own;
  }
  return own ? `${title}: ${own}` : title;
}

/** A suggestion's icon, or a target for a goal in the learner's own words. */
export function GoalIcon({
  suggestionId,
  suggestions,
  className = 'size-4',
}: {
  suggestionId?: string;
  suggestions: TGoalSuggestion[];
  className?: string;
}) {
  const icon = suggestions.find((suggestion) => suggestion.id === suggestionId)?.icon;
  const Icon = icon != null ? ICONS[icon] : Target;
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * The suggested goals as chips above the goal's text box. Picking one makes it the goal, which the
 * learner's own words add to; picking it again unpicks it. The chosen chip is marked with a tick
 * as well as its colour.
 */
export function GoalSuggestions({
  suggestions,
  value,
  onPick,
}: {
  suggestions: TGoalSuggestion[];
  /** The chosen suggestion's id, or null. */
  value: string | null;
  onPick: (suggestion: TGoalSuggestion | null) => void;
}) {
  const localize = useLocalize();
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-text-secondary text-sm">
        {localize('com_agency_goal_suggestions')}
      </p>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => {
          const pressed = suggestion.id === value;
          return (
            <button
              key={suggestion.id}
              type="button"
              aria-pressed={pressed}
              title={suggestion.description}
              onClick={() => onPick(pressed ? null : suggestion)}
              className={cn(
                'focus-visible:ring-ring-primary flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none',
                pressed
                  ? 'border-border-heavy bg-surface-active text-text-primary'
                  : 'border-border-light text-text-secondary hover:bg-surface-hover',
              )}
            >
              {pressed ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <GoalIcon suggestionId={suggestion.id} suggestions={suggestions} />
              )}
              {suggestion.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
