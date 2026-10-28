import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/** Whether a sent message shows what it sent the model, by message id. */
export const sentPromptOpenFamily = atomFamily((_messageId: string) => atom(false));
