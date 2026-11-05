import { useSetAtom } from 'jotai';
import { ErrorTypes } from 'librechat-data-provider';
import type { TSafeguardingErrorInfo } from 'librechat-data-provider';
import { safeguardingNoticeAtom } from '~/store/safeguarding';

/**
 * The safeguarding notice of text the server blocked (or could not screen) when saving a goal
 * or intentions, if that is why saving failed.
 */
export function blockedInfo(error: unknown): TSafeguardingErrorInfo | null {
  const data = (error as { response?: { data?: { type?: string; info?: unknown } } })?.response
    ?.data;
  return data?.type === ErrorTypes.SAFEGUARDING && data.info != null
    ? (data.info as TSafeguardingErrorInfo)
    : null;
}

/** Shows the safeguarding notice for a failed save the server blocked; false for any other failure. */
export function useShowBlocked(): (error: unknown) => boolean {
  const showSafeguardingNotice = useSetAtom(safeguardingNoticeAtom);
  return (error) => {
    const info = blockedInfo(error);
    if (info == null) {
      return false;
    }
    showSafeguardingNotice(info);
    return true;
  };
}
