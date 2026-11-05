import { useEffect, useId, useState } from 'react';
import { useAtom } from 'jotai';
import { AGENCY_FACTORS, AGENCY_TEXT_MAX } from 'librechat-data-provider';
import {
  Label,
  Radio,
  Button,
  Spinner,
  Textarea,
  OGDialog,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
  OGDialogDescription,
} from '@librechat/client';
import type { AgencyFactor, TAgencyIntentions } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useGetStartupConfig,
  useAgencyIntentionsQuery,
  useUpdateAgencyIntentionsMutation,
} from '~/data-provider';
import { FACTOR_KEYS, IMPORTANCE_KEYS } from './factors';
import { intentionsDialogAtom } from '~/store/agency';
import { trackAction } from '~/lib/rum/actions';
import { useShowBlocked } from './blocked';
import { useLocalize } from '~/hooks';

type TextField = 'goals' | 'intendedUse' | 'commitments';

const TEXT_FIELDS: Array<{
  field: TextField;
  label: TranslationKeys;
  hint: TranslationKeys;
  placeholder: TranslationKeys;
}> = [
  {
    field: 'goals',
    label: 'com_agency_goals',
    hint: 'com_agency_goals_hint',
    placeholder: 'com_agency_goals_placeholder',
  },
  {
    field: 'intendedUse',
    label: 'com_agency_intended_use',
    hint: 'com_agency_intended_use_hint',
    placeholder: 'com_agency_intended_use_placeholder',
  },
  {
    field: 'commitments',
    label: 'com_agency_commitments',
    hint: 'com_agency_commitments_hint',
    placeholder: 'com_agency_commitments_placeholder',
  },
];

type Draft = Omit<TAgencyIntentions, 'updatedAt'>;

const EMPTY: Draft = { goals: '', intendedUse: '', commitments: '', factors: {} };

const toDraft = (intentions: TAgencyIntentions | null | undefined): Draft =>
  intentions == null
    ? EMPTY
    : {
        goals: intentions.goals,
        intendedUse: intentions.intendedUse,
        commitments: intentions.commitments,
        factors: { ...intentions.factors },
      };

function FactorRating({
  factor,
  value,
  onChange,
}: {
  factor: AgencyFactor;
  value?: number;
  onChange: (value: number) => void;
}) {
  const localize = useLocalize();
  const labelId = useId();
  const { name, summary } = FACTOR_KEYS[factor];
  return (
    <div className="flex flex-col gap-2 py-3">
      <div>
        <p id={labelId} className="font-medium">
          {localize(name)}
        </p>
        <p className="text-text-secondary text-xs">{localize(summary)}</p>
      </div>
      <Radio
        wrap
        size="sm"
        aria-labelledby={labelId}
        value={value == null ? '' : String(value)}
        onChange={(next) => onChange(Number(next))}
        options={IMPORTANCE_KEYS.map((key, index) => ({
          value: String(index + 1),
          label: localize(key),
        }))}
      />
    </div>
  );
}

/**
 * A learner's long-term intentions: what they are working toward, how they mean to use the
 * assistant, what they commit not to do, and how much each AE-AI factor matters to them.
 * These are shown back on the recap page and never sent to a model.
 */
export default function AgencyIntentions() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const showBlocked = useShowBlocked();
  const { data, isLoading, isError } = useAgencyIntentionsQuery();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const mutation = useUpdateAgencyIntentionsMutation({
    onSuccess: () => {
      showToast({ message: localize('com_agency_intentions_saved') });
      trackAction('agency.intentions_updated');
    },
    onError: (error) => {
      if (showBlocked(error)) {
        return;
      }
      showToast({ message: localize('com_agency_intentions_save_error'), status: 'error' });
    },
  });

  useEffect(() => {
    setDraft(toDraft(data?.intentions));
  }, [data?.intentions]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-4" role="status">
        <Spinner aria-label={localize('com_ui_loading')} />
      </div>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="text-text-destructive">
        {localize('com_agency_intentions_load_error')}
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(draft);
      }}
    >
      {TEXT_FIELDS.map(({ field, label, hint, placeholder }) => (
        <div key={field} className="flex flex-col gap-1.5">
          <Label htmlFor={`agency-${field}`} className="font-medium">
            {localize(label)}
          </Label>
          <p id={`agency-${field}-hint`} className="text-text-secondary text-xs">
            {localize(hint)}
          </p>
          <Textarea
            id={`agency-${field}`}
            aria-describedby={`agency-${field}-hint`}
            maxLength={AGENCY_TEXT_MAX}
            placeholder={localize(placeholder)}
            value={draft[field]}
            onChange={(event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }))}
          />
        </div>
      ))}
      <fieldset className="flex flex-col">
        <legend className="font-medium">{localize('com_agency_factors')}</legend>
        <p className="text-text-secondary text-xs">{localize('com_agency_factors_hint')}</p>
        {AGENCY_FACTORS.map((factor) => (
          <FactorRating
            key={factor}
            factor={factor}
            value={draft.factors[factor]}
            onChange={(value) =>
              setDraft((prev) => ({ ...prev, factors: { ...prev.factors, [factor]: value } }))
            }
          />
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isLoading}>
          {localize(mutation.isLoading ? 'com_ui_saving' : 'com_ui_save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * The long-term intentions dialog, opened from the sidebar (`agency.intentions`). Saving keeps
 * it open, so the learner sees the saved state; closing it drops any unsaved change.
 */
export function IntentionsDialog() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const enabled = startupConfig?.agency?.intentions === true;
  const [open, setOpen] = useAtom(intentionsDialogAtom);
  return (
    <OGDialog open={enabled && open} onOpenChange={setOpen}>
      <OGDialogContent className="max-h-[90vh] w-11/12 max-w-2xl overflow-y-auto">
        <OGDialogHeader className="text-left">
          <OGDialogTitle>{localize('com_agency_intentions_title')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_agency_intentions_intro')}</OGDialogDescription>
        </OGDialogHeader>
        {open && <AgencyIntentions />}
      </OGDialogContent>
    </OGDialog>
  );
}
