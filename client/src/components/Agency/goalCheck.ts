import { AGENCY_QUESTION_IDS } from 'librechat-data-provider';
import type { createStore } from 'jotai';
import { goalEditorHostAtom, goalEditorOpenAtom, heldGoalCheckAtom } from '~/store/agency';

type Store = ReturnType<typeof createStore>;

/** Whether a learner answered the model's goal check by saying their goal has changed. */
export function isGoalChangedAnswer(answers: Record<string, string>): boolean {
  return answers[AGENCY_QUESTION_IDS.goalCheck] === 'goal_changed';
}

/**
 * Holds a "my goal has changed" answer back while the learner updates their goal, so the run
 * stays paused: the goal editor opens, and `submit` sends the answer once the new goal is
 * saved. Returns false, holding nothing, for any other answer or when no goal editor is shown.
 */
export function holdForGoalChange(
  store: Store,
  answers: Record<string, string>,
  submit: () => void,
): boolean {
  if (!isGoalChangedAnswer(answers) || !store.get(goalEditorHostAtom)) {
    return false;
  }
  store.set(heldGoalCheckAtom, { submit });
  store.set(goalEditorOpenAtom, true);
  return true;
}
