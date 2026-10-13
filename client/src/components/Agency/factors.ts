import type { AgencyFactor } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** Copy for each AE-AI factor: its name, a summary of its items, and a question to reflect on. */
export const FACTOR_KEYS: Record<
  AgencyFactor,
  { name: TranslationKeys; summary: TranslationKeys; reflect: TranslationKeys }
> = {
  guiding: {
    name: 'com_agency_factor_guiding',
    summary: 'com_agency_factor_guiding_summary',
    reflect: 'com_agency_factor_guiding_reflect',
  },
  checking: {
    name: 'com_agency_factor_checking',
    summary: 'com_agency_factor_checking_summary',
    reflect: 'com_agency_factor_checking_reflect',
  },
  beyond: {
    name: 'com_agency_factor_beyond',
    summary: 'com_agency_factor_beyond_summary',
    reflect: 'com_agency_factor_beyond_reflect',
  },
  reflecting: {
    name: 'com_agency_factor_reflecting',
    summary: 'com_agency_factor_reflecting_summary',
    reflect: 'com_agency_factor_reflecting_reflect',
  },
};

/** Importance, from 1 (index 0) to 5. */
export const IMPORTANCE_KEYS: TranslationKeys[] = [
  'com_agency_importance_1',
  'com_agency_importance_2',
  'com_agency_importance_3',
  'com_agency_importance_4',
  'com_agency_importance_5',
];
