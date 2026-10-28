import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The search parameter naming a message to scroll to when a conversation opens. */
export const MESSAGE_PARAM = 'message';

/** A link that opens a conversation at one of its messages. */
export function messageLink(conversationId: string, messageId?: string): string {
  const path = `/c/${encodeURIComponent(conversationId)}`;
  return messageId ? `${path}?${MESSAGE_PARAM}=${encodeURIComponent(messageId)}` : path;
}

/**
 * Scrolls to the message a `?message=` link names once it renders, then drops the parameter
 * so a later re-render does not scroll again. A message on a branch that is not shown is not
 * in the page, and the conversation just opens.
 */
export function useLinkedMessage(ready: boolean): void {
  const [params, setParams] = useSearchParams();
  const messageId = params.get(MESSAGE_PARAM);

  useEffect(() => {
    if (!ready || !messageId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(messageId);
      if (element != null) {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        element.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      }
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(MESSAGE_PARAM);
          return next;
        },
        { replace: true },
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, messageId, setParams]);
}
