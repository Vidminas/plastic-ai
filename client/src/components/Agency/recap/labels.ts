import type { AgencySupportType, TAgencyStartupConfig } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

export const SUPPORT_KEYS: Record<AgencySupportType, TranslationKeys> = {
  explanation: 'com_agency_support_explanation',
  hint: 'com_agency_support_hint',
  quiz: 'com_agency_support_quiz',
  ideas: 'com_agency_support_ideas',
  feedback: 'com_agency_support_feedback',
  answer: 'com_agency_support_answer',
  other: 'com_agency_support_other',
};

/** A sign of agency as the browser receives it. */
export type SignalLabel = NonNullable<TAgencyStartupConfig['classifier']>['signals'][number];

/** The signs of agency still configured, by count, most first. */
export function rankSignals(
  counts: Record<string, number>,
  signals: SignalLabel[],
): Array<{ signal: SignalLabel; count: number }> {
  return signals
    .map((signal) => ({ signal, count: counts[signal.id] ?? 0 }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Support types by count, most first, with "other" last. */
export function rankSupport(
  support: Partial<Record<AgencySupportType, number>>,
): Array<[AgencySupportType, number]> {
  return (Object.entries(support) as Array<[AgencySupportType, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => Number(a[0] === 'other') - Number(b[0] === 'other') || b[1] - a[1]);
}
