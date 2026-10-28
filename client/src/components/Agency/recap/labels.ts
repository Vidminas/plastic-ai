import type { AgencySupportType } from 'librechat-data-provider';
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

/** Support types by count, most first, with "other" last. */
export function rankSupport(
  support: Partial<Record<AgencySupportType, number>>,
): Array<[AgencySupportType, number]> {
  return (Object.entries(support) as Array<[AgencySupportType, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => Number(a[0] === 'other') - Number(b[0] === 'other') || b[1] - a[1]);
}
