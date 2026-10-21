import { atom } from 'jotai';

/**
 * The goal set on the goal card of a new conversation, and the suggested goal it started from,
 * sent with its first message.
 */
export const pendingGoalAtom = atom<{ text: string; suggestionId: string | null } | null>(null);

/**
 * Where the goal card of the new conversation now open has got to. While it is `ask`, the
 * card stands in for the composer; setting a goal or skipping brings the composer back.
 */
export const goalCardStepAtom = atom<'ask' | 'set' | 'skipped'>('ask');

/** Opens the goal editor of the open conversation, e.g. after a goal check says it changed. */
export const goalEditorOpenAtom = atom<boolean>(false);

/** A goal editor is on screen for the open conversation, so a goal check can wait on it. */
export const goalEditorHostAtom = atom<boolean>(false);

/**
 * A goal check answered "my goal has changed", held back so the run stays paused until the
 * learner saves their new goal; `submit` then sends the answer and the run goes on.
 */
export const heldGoalCheckAtom = atom<{ submit: () => void } | null>(null);

/** Whether the long-term intentions dialog, opened from the sidebar, is open. */
export const intentionsDialogAtom = atom<boolean>(false);
