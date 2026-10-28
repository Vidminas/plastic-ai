import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { checkAgencyPrompt, AGENCY_PROMPT_MAX } from 'librechat-data-provider';
import {
  Label,
  Button,
  Spinner,
  HoverCard,
  Textarea,
  HoverCardTrigger,
  useToastContext,
} from '@librechat/client';
import type { AgencyPromptErrorCode, TAgencyPromptError } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  useAgencyPromptQuery,
  useResetAgencyPromptMutation,
  useUpdateAgencyPromptMutation,
} from '~/data-provider';
import { useShowBlocked } from '~/components/Agency/blocked';
import useDebounce from '~/hooks/Input/useDebounce';
import { useLiveAnnouncer } from '~/Providers';
import OptionHover from './OptionHover';
import { useLocalize } from '~/hooks';
import { ESide } from '~/common';

/** How long typing pauses before the template is checked again. */
const CHECK_DELAY_MS = 200;

const ERROR_KEYS: Record<AgencyPromptErrorCode, TranslationKeys> = {
  malformed_tag: 'com_agency_prompt_error_malformed_tag',
  unknown_variable: 'com_agency_prompt_error_unknown_variable',
  unknown_section: 'com_agency_prompt_error_unknown_section',
  unexpected_close: 'com_agency_prompt_error_unexpected_close',
  mismatched_close: 'com_agency_prompt_error_mismatched_close',
  unclosed_section: 'com_agency_prompt_error_unclosed_section',
};

/** The template mistakes in a failed save, when that is why it failed. */
function invalidTemplateErrors(error: unknown): TAgencyPromptError[] | null {
  const data = (error as { response?: { data?: { code?: string; errors?: unknown } } })?.response
    ?.data;
  return data?.code === 'invalid_template' && Array.isArray(data.errors)
    ? (data.errors as TAgencyPromptError[])
    : null;
}

/**
 * The learner's prompt template, in the Parameters panel below the system prompt: the text every
 * turn carries after it, for all their chats. Its syntax is checked as they type, and a template
 * with mistakes cannot be saved; an empty one sends their messages on their own.
 */
export default function AgencyPrompt() {
  const id = useId();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { announcePolite } = useLiveAnnouncer();
  const showBlocked = useShowBlocked();
  const { data, isLoading, isError, refetch } = useAgencyPromptQuery();
  const saved = data?.prompt.template ?? data?.default ?? '';
  const customised = data?.prompt.template != null;

  const [draft, setDraft] = useState(saved);
  const [serverErrors, setServerErrors] = useState<TAgencyPromptError[] | null>(null);
  const [masked, setMasked] = useState(false);
  /** Follows the saved text only while nothing unsaved is in the field. */
  const lastSaved = useRef(saved);
  useEffect(() => {
    const previous = lastSaved.current;
    lastSaved.current = saved;
    setDraft((current) => (current === previous ? saved : current));
  }, [saved]);

  const settled = useDebounce(draft, CHECK_DELAY_MS);
  const check = useMemo(() => checkAgencyPrompt(settled), [settled]);
  const errors = serverErrors ?? (check.ok ? [] : check.errors);

  const update = useUpdateAgencyPromptMutation({
    onSuccess: (result) => {
      setDraft(result.prompt.template ?? data?.default ?? '');
      setMasked(result.masked);
      showToast({ message: localize('com_agency_prompt_saved') });
    },
    onError: (error) => {
      if (showBlocked(error)) {
        return;
      }
      const invalid = invalidTemplateErrors(error);
      if (invalid != null) {
        setServerErrors(invalid);
        return;
      }
      showToast({ message: localize('com_agency_prompt_save_error'), status: 'error' });
    },
  });
  const reset = useResetAgencyPromptMutation({
    onSuccess: () => {
      setDraft(data?.default ?? '');
      setServerErrors(null);
      setMasked(false);
      announcePolite({ message: localize('com_agency_prompt_reset_done'), isStatus: true });
    },
    onError: () =>
      showToast({ message: localize('com_agency_prompt_reset_error'), status: 'error' }),
  });

  if (isLoading) {
    return (
      <div role="status" className="col-span-2 flex justify-center py-2">
        <Spinner className="size-4" aria-label={localize('com_ui_loading')} />
      </div>
    );
  }
  if (isError || data == null) {
    return (
      <div className="text-text-secondary col-span-2 flex items-center justify-between gap-2 text-xs">
        <span>{localize('com_agency_prompt_load_error')}</span>
        <Button variant="outline" size="compact" type="button" onClick={() => refetch()}>
          {localize('com_ui_retry')}
        </Button>
      </div>
    );
  }

  const textareaId = `${id}-agency-prompt`;
  const labelId = `${id}-agency-prompt-label`;
  const errorsId = `${id}-agency-prompt-errors`;
  const busy = update.isLoading || reset.isLoading;
  const invalid = errors.length > 0;
  const unchanged = draft === saved;

  /** Checks what is in the field now, not what the last pause checked. */
  const save = () => {
    const current = checkAgencyPrompt(draft);
    if (!current.ok) {
      setServerErrors(current.errors);
      return;
    }
    update.mutate(draft);
  };

  return (
    <div className="col-span-2 flex flex-col gap-2">
      <HoverCard openDelay={300}>
        <HoverCardTrigger className="w-full">
          <div className="grid w-full gap-2">
            <div className="flex w-full items-center justify-between gap-2">
              <Label id={labelId} htmlFor={textareaId} className="text-left text-xs font-medium">
                {localize('com_agency_prompt_label')}
              </Label>
              <span className="bg-surface-tertiary text-text-secondary shrink-0 rounded-full px-1.5 text-xs">
                {localize(
                  customised ? 'com_agency_prompt_customised' : 'com_agency_prompt_default',
                )}
              </span>
            </div>
            <Textarea
              id={textareaId}
              aria-labelledby={labelId}
              rows={6}
              maxLength={AGENCY_PROMPT_MAX}
              value={draft}
              disabled={busy}
              onChange={(event) => {
                setDraft(event.target.value);
                setServerErrors(null);
                setMasked(false);
              }}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorsId : undefined}
            />
          </div>
        </HoverCardTrigger>
        <OptionHover
          description={localize('com_agency_prompt_help', {
            goal: '{{goal}}',
            open: '{{#goal}}',
            close: '{{/goal}}',
          })}
          side={ESide.Left}
        />
      </HoverCard>
      <div aria-live="polite">
        {invalid && (
          <ul id={errorsId} className="text-text-destructive flex flex-col gap-1 text-xs">
            {errors.map((error) => (
              <li key={`${error.code}-${error.line}-${error.column}`}>
                {localize(ERROR_KEYS[error.code], {
                  line: error.line,
                  tag: error.tag,
                  open: `{{#${error.expected ?? ''}}}`,
                  close: error.tag.replace('{{#', '{{/'),
                  known: '{{goal}}',
                })}
              </li>
            ))}
          </ul>
        )}
        {masked && !invalid && (
          <p className="text-text-secondary text-xs">{localize('com_agency_prompt_masked')}</p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {customised && (
          <Button
            variant="outline"
            size="compact"
            type="button"
            disabled={busy}
            onClick={() => reset.mutate()}
          >
            {localize('com_agency_prompt_reset')}
          </Button>
        )}
        <Button
          variant="outline"
          size="compact"
          type="button"
          disabled={busy || unchanged || invalid}
          onClick={save}
        >
          {localize('com_ui_save')}
        </Button>
      </div>
    </div>
  );
}
