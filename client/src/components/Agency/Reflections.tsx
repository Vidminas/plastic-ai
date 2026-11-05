import { useEffect, useId, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Info, NotebookPen, Plus } from 'lucide-react';
import { AGENCY_REFLECTION_QUESTIONS, AGENCY_TEXT_MAX } from 'librechat-data-provider';
import {
  Button,
  Spinner,
  OGDialog,
  Textarea,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
  OGDialogDescription,
} from '@librechat/client';
import type {
  TAgencyReflection,
  AgencyReflectionQuestion,
  TAgencyReflectionAnswers,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useGetStartupConfig,
  useAgencyReflectionsQuery,
  useCreateAgencyReflectionMutation,
  useUpdateAgencyReflectionMutation,
} from '~/data-provider';
import { reflectionDialogAtom } from '~/store/agency';
import { trackAction } from '~/lib/rum/actions';
import { useShowBlocked } from './blocked';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export const QUESTION_KEYS: Record<AgencyReflectionQuestion, TranslationKeys> = {
  working_on: 'com_agency_reflection_q_working_on',
  decision: 'com_agency_reflection_q_decision',
  reason: 'com_agency_reflection_q_reason',
  outcome: 'com_agency_reflection_q_outcome',
  happy: 'com_agency_reflection_q_happy',
};

const BLANK: TAgencyReflectionAnswers = {
  working_on: '',
  decision: '',
  reason: '',
  outcome: '',
  happy: '',
};

const savedAt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A question, or an answer, as a speech bubble: the questions on the left, answers on the right. */
function Bubble({ answer = false, children }: { answer?: boolean; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap',
        answer
          ? 'bg-surface-user-message text-text-primary self-end'
          : 'bg-surface-secondary text-text-primary self-start',
      )}
    >
      {children}
    </p>
  );
}

/**
 * Writes or edits one reflection: the questions one at a time, each answered or skipped, with the
 * answers so far above. Saving needs at least one answer.
 */
function ReflectionWriter({
  reflection,
  onClose,
}: {
  /** The reflection being edited; absent for a new one. */
  reflection?: TAgencyReflection;
  /** After saving, or on cancel. */
  onClose: () => void;
}) {
  const localize = useLocalize();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { showToast } = useToastContext();
  const showBlocked = useShowBlocked();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<TAgencyReflectionAnswers>(reflection?.answers ?? BLANK);
  const options = {
    onSuccess: () => {
      showToast({ message: localize('com_agency_reflection_saved') });
      trackAction('agency.reflection_saved', { edited: reflection != null });
      onClose();
    },
    onError: (error: Error) => {
      if (showBlocked(error)) {
        return;
      }
      showToast({ message: localize('com_agency_reflection_save_error'), status: 'error' });
    },
  };
  const create = useCreateAgencyReflectionMutation(options);
  const update = useUpdateAgencyReflectionMutation(options);
  const busy = create.isLoading || update.isLoading;

  const question = AGENCY_REFLECTION_QUESTIONS[step];
  const last = step === AGENCY_REFLECTION_QUESTIONS.length - 1;
  const anyAnswer = Object.values(answers).some((answer) => answer.trim().length > 0);
  /** Skipping the last question still saves, as long as another question was answered. */
  const othersAnswered = AGENCY_REFLECTION_QUESTIONS.some(
    (other) => other !== question && answers[other].trim().length > 0,
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const save = (final: TAgencyReflectionAnswers) => {
    const trimmed = Object.fromEntries(
      Object.entries(final).map(([key, value]) => [key, value.trim()]),
    ) as TAgencyReflectionAnswers;
    if (reflection != null) {
      update.mutate({ reflectionId: reflection.id, reflection: { answers: trimmed } });
    } else {
      create.mutate({ answers: trimmed });
    }
  };
  const next = (final: TAgencyReflectionAnswers) => {
    if (last) {
      save(final);
      return;
    }
    setStep((current) => current + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-secondary text-xs font-medium">
        {localize('com_agency_reflection_step', {
          0: step + 1,
          1: AGENCY_REFLECTION_QUESTIONS.length,
        })}
      </p>
      <div className="border-border-light bg-surface-primary flex flex-col gap-3 rounded-2xl border p-4">
        <p className="text-text-secondary flex items-start gap-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {localize('com_agency_reflection_intro')}
        </p>
        <div className="flex flex-col gap-2" aria-live="polite">
          {AGENCY_REFLECTION_QUESTIONS.slice(0, step).map((asked) => (
            <div key={asked} className="flex flex-col gap-2">
              <Bubble>{localize(QUESTION_KEYS[asked])}</Bubble>
              {answers[asked].trim() ? (
                <Bubble answer>{answers[asked]}</Bubble>
              ) : (
                <p className="text-text-tertiary self-end text-xs">
                  {localize('com_agency_reflection_skipped')}
                </p>
              )}
            </div>
          ))}
          <Bubble>
            <label htmlFor={inputId}>{localize(QUESTION_KEYS[question])}</label>
          </Bubble>
        </div>
        <Textarea
          id={inputId}
          ref={inputRef}
          value={answers[question]}
          maxLength={AGENCY_TEXT_MAX}
          placeholder={localize('com_agency_reflection_placeholder')}
          onChange={(event) => setAnswers((prev) => ({ ...prev, [question]: event.target.value }))}
        />
        <p className="text-text-secondary text-xs">{localize('com_agency_reflection_footnote')}</p>
      </div>
      {last && !anyAnswer && (
        <p role="status" className="text-text-secondary text-sm">
          {localize('com_agency_reflection_empty_answers')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          {localize('com_ui_cancel')}
        </Button>
        <div className="flex flex-wrap gap-2">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setStep((current) => current - 1)}
            >
              {localize('com_ui_back')}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy || (last && !othersAnswered)}
            onClick={() => {
              const skipped = { ...answers, [question]: '' };
              setAnswers(skipped);
              next(skipped);
            }}
          >
            {localize(last ? 'com_agency_reflection_skip_save' : 'com_ui_skip')}
          </Button>
          <Button
            type="button"
            disabled={busy || (last ? !anyAnswer : !answers[question].trim())}
            onClick={() => next(answers)}
          >
            {localize(last ? 'com_agency_reflection_save' : 'com_ui_next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A saved reflection: what it was about, when it was saved and edited, and its answers. */
function ReflectionItem({
  reflection,
  onEdit,
}: {
  reflection: TAgencyReflection;
  onEdit: () => void;
}) {
  const localize = useLocalize();
  const answersId = useId();
  const [open, setOpen] = useState(false);
  const edited = reflection.updatedAt !== reflection.createdAt;
  return (
    <li className="border-border-light flex flex-col gap-2 border-t py-3 first:border-t-0">
      <div className="flex items-start gap-3">
        <span className="bg-surface-tertiary text-text-secondary rounded-lg p-2" aria-hidden="true">
          <NotebookPen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-text-primary truncate text-sm font-medium">
            {reflection.answers.working_on || localize('com_agency_reflection_untitled')}
          </p>
          <p className="text-text-secondary text-xs">
            <time dateTime={reflection.createdAt}>
              {localize('com_agency_reflection_saved_at', {
                0: savedAt.format(new Date(reflection.createdAt)),
              })}
            </time>
            {edited && (
              <>
                {' · '}
                <time dateTime={reflection.updatedAt}>
                  {localize('com_agency_reflection_edited_at', {
                    0: savedAt.format(new Date(reflection.updatedAt)),
                  })}
                </time>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-controls={answersId}
            onClick={() => setOpen((prev) => !prev)}
          >
            {localize(open ? 'com_agency_reflection_hide' : 'com_agency_reflection_review')}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            {localize('com_ui_edit')}
          </Button>
        </div>
      </div>
      {open && (
        <dl id={answersId} className="flex flex-col gap-2 ps-11 text-sm">
          {AGENCY_REFLECTION_QUESTIONS.map((question) => (
            <div key={question}>
              <dt className="text-text-secondary text-xs">{localize(QUESTION_KEYS[question])}</dt>
              <dd
                className={cn(
                  '[overflow-wrap:anywhere] whitespace-pre-wrap',
                  reflection.answers[question] ? 'text-text-primary' : 'text-text-tertiary',
                )}
              >
                {reflection.answers[question] || localize('com_agency_reflection_skipped')}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

type View = { kind: 'list' } | { kind: 'write'; reflection?: TAgencyReflection };

/**
 * The reflections dialog, opened from the sidebar (`agency.reflections`): the learner's saved
 * reflections to review and edit, and a new one to write, as often as they like.
 */
export default function ReflectionDialog() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const enabled = startupConfig?.agency?.reflections === true;
  const [state, setState] = useAtom(reflectionDialogAtom);
  const open = enabled && state != null;
  const { data, isLoading, isError } = useAgencyReflectionsQuery({ enabled: open });
  const [view, setView] = useState<View>({ kind: 'list' });
  const reflections = data?.reflections ?? [];

  /** Opened at one reflection, from the recap: edit it once the list is loaded. */
  const requested = state?.reflectionId;
  useEffect(() => {
    if (requested == null || data == null) {
      return;
    }
    const reflection = data.reflections.find((other) => other.id === requested);
    setView(reflection != null ? { kind: 'write', reflection } : { kind: 'list' });
    setState({});
  }, [data, requested, setState]);

  /** Every opening starts at the list. */
  useEffect(() => {
    if (!open) {
      setView({ kind: 'list' });
    }
  }, [open]);

  let titleKey: TranslationKeys = 'com_agency_reflections_title';
  if (view.kind === 'write') {
    titleKey =
      view.reflection != null
        ? 'com_agency_reflection_edit_title'
        : 'com_agency_reflection_new_title';
  }

  let body: React.ReactNode;
  if (view.kind === 'write') {
    body = (
      <ReflectionWriter
        key={view.reflection?.id ?? 'new'}
        reflection={view.reflection}
        onClose={() => setView({ kind: 'list' })}
      />
    );
  } else if (isLoading) {
    body = (
      <div className="flex justify-center py-6" role="status">
        <Spinner aria-label={localize('com_ui_loading')} />
      </div>
    );
  } else if (isError) {
    body = (
      <p role="alert" className="text-text-destructive text-sm">
        {localize('com_agency_reflection_load_error')}
      </p>
    );
  } else {
    /** The dialog is a grid, whose items grow to their widest content: without `min-w-0`, a long
     *  title would push the list past the dialog instead of being truncated. */
    body = (
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <Button type="button" onClick={() => setView({ kind: 'write' })}>
            <Plus className="me-1.5 size-4" aria-hidden="true" />
            {localize('com_agency_reflection_new')}
          </Button>
        </div>
        {reflections.length === 0 ? (
          <p className="text-text-secondary text-sm">{localize('com_agency_reflection_none')}</p>
        ) : (
          <ul aria-label={localize('com_agency_reflection_list')}>
            {reflections.map((reflection) => (
              <ReflectionItem
                key={reflection.id}
                reflection={reflection}
                onEdit={() => setView({ kind: 'write', reflection })}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <OGDialog open={open} onOpenChange={(next) => !next && setState(null)}>
      <OGDialogContent className="max-h-[90vh] w-11/12 max-w-2xl overflow-y-auto">
        <OGDialogHeader className="text-left">
          <OGDialogTitle>{localize(titleKey)}</OGDialogTitle>
          <OGDialogDescription>{localize('com_agency_reflections_help')}</OGDialogDescription>
        </OGDialogHeader>
        {body}
      </OGDialogContent>
    </OGDialog>
  );
}
