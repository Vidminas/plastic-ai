import { useEffect, useId, useRef, useState } from 'react';
import { Target } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Constants, AGENCY_TEXT_MAX } from 'librechat-data-provider';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import { Button, Spinner, Textarea, useToastContext } from '@librechat/client';
import type { TGoalSuggestion } from 'librechat-data-provider';
import {
  recordAgencyEvent,
  useGetStartupConfig,
  useConversationGoalQuery,
  useUpdateConversationGoalMutation,
} from '~/data-provider';
import {
  pendingGoalAtom,
  goalCardStepAtom,
  heldGoalCheckAtom,
  goalEditorOpenAtom,
  goalEditorHostAtom,
} from '~/store/agency';
import { composeGoal, GoalSuggestions, leadingSuggestion, useGoalSuggestions } from './goals';
import { useLocalize, useSubmitMessage } from '~/hooks';
import { trackAction } from '~/lib/rum/actions';
import { requestChatFocus } from '~/utils';
import { useShowBlocked } from './blocked';

/** Whether this deployment asks for conversation goals (`agency.conversationGoal`). */
export function useConversationGoalsEnabled(): boolean {
  const { data: startupConfig } = useGetStartupConfig();
  return startupConfig?.agency?.conversationGoal === true;
}

/**
 * Whether the goal card stands in for the composer of a new conversation: goals are on and the
 * learner has neither set one nor skipped it. A prompt in the address bar (`?prompt=`, `?q=`)
 * needs the composer to stage and send it, so it goes straight to the composer.
 */
export function useGoalCardAsking(): boolean {
  const enabled = useConversationGoalsEnabled();
  const step = useAtomValue(goalCardStepAtom);
  const [params] = useSearchParams();
  return enabled && step === 'ask' && !params.has('prompt') && !params.has('q');
}

function GoalEditor({
  initial,
  busy = false,
  submitLabel,
  onSubmit,
  onCancel,
  cancelLabel,
}: {
  initial: string;
  busy?: boolean;
  submitLabel: string;
  onSubmit: (text: string, suggestionId: string | null) => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const localize = useLocalize();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = useGoalSuggestions();
  const titleOf = (id: string | null) => suggestions.find((other) => other.id === id)?.title;
  /**
   * The goal is the chosen suggestion's title followed by whatever the learner wrote, joined as
   * plain text. A goal reopened for editing is all in the text box, and stays tied to a
   * suggestion only while it still starts with that suggestion's title.
   */
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [text, setText] = useState(initial);
  const goal = composeGoal(titleOf(suggestion), text, suggestions);

  const pick = (picked: TGoalSuggestion | null) => {
    setSuggestion(picked?.id ?? null);
    inputRef.current?.focus();
  };

  /** It replaces the composer, so it takes the focus the composer would have had. */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (goal) {
          onSubmit(goal, suggestion ?? leadingSuggestion(goal, suggestions)?.id ?? null);
        }
      }}
    >
      {suggestions.length > 0 && (
        <GoalSuggestions suggestions={suggestions} value={suggestion} onPick={pick} />
      )}
      <label htmlFor={inputId} className="sr-only">
        {localize(suggestion != null ? 'com_agency_goal_details_label' : 'com_agency_goal_label')}
      </label>
      <Textarea
        id={inputId}
        ref={inputRef}
        maxLength={AGENCY_TEXT_MAX}
        value={text}
        placeholder={localize(
          suggestion != null
            ? 'com_agency_goal_details_placeholder'
            : 'com_agency_goal_placeholder',
        )}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit" size="sm" disabled={busy || !goal}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function GoalLine({ text, onEdit }: { text: string; onEdit: () => void }) {
  const localize = useLocalize();
  return (
    <div className="text-text-secondary flex items-center gap-2 px-1 text-sm">
      <Target className="icon-sm shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate" title={text}>
        <span className="text-text-primary font-medium">{localize('com_agency_goal_prefix')}</span>{' '}
        {text}
      </p>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        {localize('com_ui_edit')}
      </Button>
    </div>
  );
}

/**
 * The goal panel: what a goal is for and how it is used, above the editor. Setting a first goal
 * and changing one later look the same; `note` adds a line, such as why the reply is waiting.
 */
function GoalPanel({ note, ...editor }: Parameters<typeof GoalEditor>[0] & { note?: string }) {
  const localize = useLocalize();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="border-border-light bg-surface-primary mx-auto mb-3 w-full max-w-3xl rounded-2xl border p-4 xl:max-w-4xl"
    >
      <p className="text-text-secondary text-xs font-medium tracking-wide uppercase">
        {localize('com_agency_goal_eyebrow')}
      </p>
      <h2 id={headingId} className="text-text-primary mt-1 text-lg font-medium">
        {localize('com_agency_goal_question')}
      </h2>
      <p className="text-text-secondary mb-3 text-sm">{localize('com_agency_goal_help')}</p>
      {note != null && (
        <p role="status" className="text-text-primary mb-3 text-sm">
          {note}
        </p>
      )}
      <GoalEditor {...editor} />
    </section>
  );
}

/**
 * Opens the goal editor where there is no goal yet. The ghost button takes its ink from its
 * container, so the container sets the theme's secondary text colour.
 */
function AddGoalButton({ onClick }: { onClick: () => void }) {
  const localize = useLocalize();
  return (
    <div className="text-text-secondary">
      <Button type="button" variant="ghost" size="sm" onClick={onClick}>
        <Target className="icon-sm me-1.5" aria-hidden="true" />
        {localize('com_agency_goal_add')}
      </Button>
    </div>
  );
}

/**
 * The skippable goal card on a new conversation, shown instead of the composer until the
 * learner sets a goal or skips it. Setting the goal also sends it as the learner's first
 * message, which carries the goal to the server, so the chat opens on a reply to what they
 * wrote rather than on a blank page. Should that send be refused, the goal stays above the
 * composer, where it can be edited, until the first message the learner sends themselves.
 */
export function GoalCard() {
  const localize = useLocalize();
  const asking = useGoalCardAsking();
  const enabled = useConversationGoalsEnabled();
  const [pending, setPending] = useAtom(pendingGoalAtom);
  const goal = pending?.text ?? null;
  const [step, setStep] = useAtom(goalCardStepAtom);
  const { submitMessage } = useSubmitMessage();
  /** A learner who skips, adds a goal after all, then skips again skipped once. */
  const skipRecorded = useRef(false);
  /** The goal went out with a first message, which takes it from the pending atoms itself. */
  const sent = useRef(false);

  /** A goal not sent with a first message belongs to no conversation, and the next new
   *  conversation asks again. One that was sent is left for that message to take, however
   *  late it reads it. */
  useEffect(
    () => () => {
      if (!sent.current) {
        setPending(null);
      }
      sent.current = false;
      setStep('ask');
      skipRecorded.current = false;
    },
    [setPending, setStep],
  );

  if (!enabled) {
    return null;
  }
  if (step === 'skipped') {
    return (
      <div className="mx-auto mb-2 w-full max-w-3xl px-4 xl:max-w-4xl">
        <AddGoalButton onClick={() => setStep('ask')} />
      </div>
    );
  }
  if (step === 'set' && goal) {
    return (
      <div className="mx-auto mb-2 w-full max-w-3xl px-4 xl:max-w-4xl">
        <GoalLine text={goal} onEdit={() => setStep('ask')} />
      </div>
    );
  }
  if (!asking) {
    return null;
  }
  /** Editing a goal already set cancels back to it; a first goal can be skipped. */
  const editing = goal != null;
  return (
    <GoalPanel
      initial={goal ?? ''}
      submitLabel={localize('com_agency_goal_start')}
      cancelLabel={localize(editing ? 'com_ui_cancel' : 'com_ui_skip')}
      onSubmit={(text, suggestionId) => {
        /** Set first: the first message reads the pending goal as it is sent. */
        setPending({ text, suggestionId });
        setStep('set');
        trackAction('agency.goal_set');
        sent.current = submitMessage({ text }) !== false;
        if (!sent.current) {
          requestChatFocus();
        }
      }}
      onCancel={() => {
        requestChatFocus();
        if (editing) {
          setStep('set');
          return;
        }
        setStep('skipped');
        if (!skipRecorded.current) {
          skipRecorded.current = true;
          recordAgencyEvent({ type: 'goal_skipped' });
          trackAction('agency.goal_skipped');
        }
      }}
    />
  );
}

/** The goal banner of a saved conversation; none on a new one or on search. */
export function GoalBanner({ conversationId }: { conversationId?: string | null }) {
  if (
    conversationId == null ||
    conversationId === Constants.NEW_CONVO ||
    conversationId === Constants.SEARCH
  ) {
    return null;
  }
  return <ConversationGoal conversationId={conversationId} />;
}

/**
 * The goal of an open conversation, with a way to add or change it. When a goal check is
 * answered "my goal has changed", the answer waits here (`heldGoalCheckAtom`): saving the new
 * goal sends it and the reply goes on with that goal; cancelling leaves the question open.
 */
function ConversationGoal({ conversationId }: { conversationId: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const enabled = useConversationGoalsEnabled();
  const [editing, setEditing] = useAtom(goalEditorOpenAtom);
  const [held, setHeld] = useAtom(heldGoalCheckAtom);
  const setHost = useSetAtom(goalEditorHostAtom);
  const store = useStore();
  const showBlocked = useShowBlocked();
  const { data, isLoading } = useConversationGoalQuery(conversationId, { enabled });
  const suggestions = useGoalSuggestions();
  const mutation = useUpdateConversationGoalMutation({
    onSuccess: () => {
      setEditing(false);
      trackAction('agency.goal_updated', { conversationId });
      /** Read at save time: the answer may have been held after this render. */
      const pending = store.get(heldGoalCheckAtom);
      if (pending != null) {
        setHeld(null);
        pending.submit();
      }
    },
    onError: (error) => {
      if (showBlocked(error)) {
        return;
      }
      showToast({ message: localize('com_agency_goal_save_error'), status: 'error' });
    },
  });

  /** An editor opened for one conversation does not follow the learner to the next, nor
   *  does an answer held for it. */
  useEffect(() => {
    setHost(enabled);
    return () => {
      setHost(false);
      setEditing(false);
      setHeld(null);
    };
  }, [conversationId, enabled, setEditing, setHeld, setHost]);

  if (!enabled) {
    return null;
  }
  if (isLoading) {
    return <Spinner className="mx-auto mb-2" aria-label={localize('com_ui_loading')} />;
  }
  const goal = data?.goal?.text ?? '';
  let body = <AddGoalButton onClick={() => setEditing(true)} />;
  if (editing) {
    body = (
      <GoalPanel
        initial={goal}
        busy={mutation.isLoading}
        note={held != null ? localize('com_agency_goal_check_held') : undefined}
        submitLabel={localize(goal ? 'com_ui_save' : 'com_agency_goal_set')}
        cancelLabel={localize('com_ui_cancel')}
        onSubmit={(text, suggestionId) =>
          mutation.mutate({
            conversationId,
            text,
            ...(suggestions.length > 0 ? { suggestionId } : {}),
          })
        }
        onCancel={() => {
          setEditing(false);
          setHeld(null);
        }}
      />
    );
  } else if (goal) {
    body = <GoalLine text={goal} onEdit={() => setEditing(true)} />;
  }
  if (editing) {
    return body;
  }
  return <div className="mx-auto mb-2 w-full max-w-3xl px-4 xl:max-w-4xl">{body}</div>;
}
