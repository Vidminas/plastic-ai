import { useCallback, useMemo } from 'react';
import { atom, useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Agents } from 'librechat-data-provider';
import {
  useAskSubmitStatus,
  useResumeSubmit,
} from '~/components/Chat/Messages/Content/ApprovalContext';
import { ASK_USER_DECLINED_ANSWER } from '~/utils/approval';

interface AskQuestionsFormState {
  /** Index of the question currently on screen. Lives beside the answers so the
   *  composer popover and the chat card resume on the same step when one
   *  surface hands over to the other. */
  step: number;
  text: Record<string, string>;
  selected: Record<string, string[]>;
  /** Questions the user skipped. Each is sent as declined unless answered after all. */
  skipped?: Record<string, boolean>;
}

// const EMPTY_FORM: AskQuestionsFormState = { step: 0, text: {}, selected: {} };
const EMPTY_FORM: AskQuestionsFormState = { step: 0, text: {}, selected: {}, skipped: {} };

/** The question's own answer, or the declined notice when it was skipped and left unanswered. */
function resolveAnswer(
  state: AskQuestionsFormState,
  question: Agents.AskUserQuestionBatchItem,
): string | undefined {
  const text = ownValue(state.text, question.id)?.trim() ?? '';
  const selected = ownValue(state.selected, question.id) ?? [];
  const values = question.multiSelect === true ? [...selected] : [];
  if (text.length > 0) {
    values.push(text);
  } else if (question.multiSelect !== true && selected[0] != null) {
    values.push(selected[0]);
  }
  if (values.length > 0) {
    return values.join(', ');
  }
  return ownValue(state.skipped ?? {}, question.id) === true ? ASK_USER_DECLINED_ANSWER : undefined;
}

function resolveAnswers(
  state: AskQuestionsFormState,
  questions: Agents.AskUserQuestionBatchItem[],
): Record<string, string> {
  const resolved = Object.create(null) as Record<string, string>;
  for (const question of questions) {
    const answer = resolveAnswer(state, question);
    if (answer != null) {
      resolved[question.id] = answer;
    }
  }
  return resolved;
}

/** Keyed by action id, so the composer popover and the chat card share one form. */
const askQuestionsFormFamily = atomFamily((_actionId: string) =>
  atom<AskQuestionsFormState>(EMPTY_FORM),
);

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export default function useAskQuestionsForm(
  actionId: string,
  questions: Agents.AskUserQuestionBatchItem[],
) {
  const [state, setState] = useAtom(askQuestionsFormFamily(actionId));
  const resetState = useCallback(() => setState(EMPTY_FORM), [setState]);
  const { submitAskAnswer } = useResumeSubmit();
  const { getAskStatus } = useAskSubmitStatus();
  const status = getAskStatus(actionId);
  const locked = status === 'submitting' || status === 'submitted' || status === 'expired';

  const setText = useCallback(
    (question: Agents.AskUserQuestionBatchItem, value: string) => {
      setState((previous) => ({
        ...previous,
        text: { ...previous.text, [question.id]: value },
        /** A typed answer replaces the choices: the rows lock while the field
         *  has text, so nothing stays selected behind them. */
        selected:
          value.trim().length === 0
            ? previous.selected
            : { ...previous.selected, [question.id]: [] },
      }));
    },
    [setState],
  );

  const selectOption = useCallback(
    (question: Agents.AskUserQuestionBatchItem, value: string) => {
      setState((previous) => {
        const current = ownValue(previous.selected, question.id) ?? [];
        let selected = [value];
        if (question.multiSelect === true) {
          selected = current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value];
        }
        return {
          ...previous,
          text:
            question.multiSelect === true ? previous.text : { ...previous.text, [question.id]: '' },
          selected: { ...previous.selected, [question.id]: selected },
        };
      });
    },
    [setState],
  );

  const goToStep = useCallback(
    (index: number) => {
      const bounded = Math.min(Math.max(index, 0), Math.max(questions.length - 1, 0));
      setState((previous) =>
        previous.step === bounded ? previous : { ...previous, step: bounded },
      );
    },
    [questions.length, setState],
  );

  const answers = useMemo(() => resolveAnswers(state, questions), [questions, state]);

  const canSubmit =
    !locked && questions.every((question) => (ownValue(answers, question.id)?.length ?? 0) > 0);

  const submit = useCallback(() => {
    if (!canSubmit) {
      return false;
    }
    submitAskAnswer(actionId, answers, { onSuccess: resetState });
    return true;
  }, [actionId, answers, canSubmit, resetState, submitAskAnswer]);

  // const skip = useCallback(() => {
  //   if (locked) {
  //     return false;
  //   }
  //   const declined = Object.fromEntries(
  //     questions.map((question) => [question.id, ASK_USER_DECLINED_ANSWER]),
  //   );
  //   submitAskAnswer(actionId, declined, { onSuccess: resetState });
  //   return true;
  // }, [actionId, locked, questions, resetState, submitAskAnswer]);
  /**
   * Skips the question on screen only: it is sent as declined, and the rest keep their
   * answers. Moves on to the next question still open, or sends the batch once every question
   * is answered or skipped. Answering a skipped question takes it back.
   */
  const skip = useCallback(() => {
    const current = questions[Math.min(state.step, Math.max(questions.length - 1, 0))];
    if (locked || current == null) {
      return false;
    }
    const next: AskQuestionsFormState = {
      ...state,
      text: { ...state.text, [current.id]: '' },
      selected: { ...state.selected, [current.id]: [] },
      skipped: { ...state.skipped, [current.id]: true },
    };
    const resolved = resolveAnswers(next, questions);
    const open = questions.findIndex((question) => !Object.hasOwn(resolved, question.id));
    if (open < 0) {
      setState(next);
      submitAskAnswer(actionId, resolved, { onSuccess: resetState });
      return true;
    }
    const after = questions.findIndex(
      (question, index) => index > next.step && !Object.hasOwn(resolved, question.id),
    );
    setState({ ...next, step: after >= 0 ? after : open });
    return true;
  }, [actionId, locked, questions, resetState, setState, state, submitAskAnswer]);

  return {
    state,
    step: Math.min(state.step, Math.max(questions.length - 1, 0)),
    status,
    locked,
    answers,
    canSubmit,
    setText,
    selectOption,
    goToStep,
    submit,
    skip,
  };
}
