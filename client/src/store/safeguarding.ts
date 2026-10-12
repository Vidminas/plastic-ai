import { atom } from 'jotai';
import type { TSafeguardingErrorInfo } from 'librechat-data-provider';

/** A blocked upload's notice, shown in `SafeguardingDialog` until the participant closes it. */
export const safeguardingNoticeAtom = atom<TSafeguardingErrorInfo | null>(null);
