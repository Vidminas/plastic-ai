import { createStore } from 'jotai';
import { goalEditorHostAtom, goalEditorOpenAtom, heldGoalCheckAtom } from '~/store/agency';
import { holdForGoalChange, isGoalChangedAnswer } from '../goalCheck';

describe('isGoalChangedAnswer', () => {
  it('is true only for a goal check answered goal_changed', () => {
    expect(isGoalChangedAnswer({ goal_check: 'goal_changed' })).toBe(true);
    expect(isGoalChangedAnswer({ goal_check: 'refocus' })).toBe(false);
    expect(isGoalChangedAnswer({ clarify: 'goal_changed' })).toBe(false);
  });
});

describe('holdForGoalChange', () => {
  it('holds a goal-changed answer and opens the goal editor', () => {
    const store = createStore();
    store.set(goalEditorHostAtom, true);
    const submit = jest.fn();

    expect(holdForGoalChange(store, { goal_check: 'goal_changed' }, submit)).toBe(true);
    expect(store.get(goalEditorOpenAtom)).toBe(true);
    store.get(heldGoalCheckAtom)?.submit();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('lets any other answer through', () => {
    const store = createStore();
    store.set(goalEditorHostAtom, true);
    expect(holdForGoalChange(store, { goal_check: 'continue' }, jest.fn())).toBe(false);
    expect(store.get(heldGoalCheckAtom)).toBeNull();
  });

  it('never holds an answer with no goal editor to release it', () => {
    const store = createStore();
    expect(holdForGoalChange(store, { goal_check: 'goal_changed' }, jest.fn())).toBe(false);
    expect(store.get(goalEditorOpenAtom)).toBe(false);
  });
});
