import { memo } from 'react';
import { useWatch } from 'react-hook-form';
import { countMessageCharacters } from 'librechat-data-provider';
import type { Control } from 'react-hook-form';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** The count appears once a message is this close to the limit. */
const SHOW_AT = 0.9;

const formatNumber = (value: number): string => new Intl.NumberFormat().format(value);

/**
 * Counts the composer's characters against `messageLimits.maxUserMessageChars`, shown only
 * near the limit. The count itself is not announced, since it changes with every key; the
 * live region speaks once, when the message goes over and sending is blocked.
 */
function MessageLength({ control, max }: { control: Control<{ text: string }>; max: number }) {
  const localize = useLocalize();
  const text = useWatch({ control, name: 'text' }) ?? '';
  const length = text.length < max * SHOW_AT ? text.length : countMessageCharacters(text);
  const tooLong = length > max;
  const counts = { 0: formatNumber(length), 1: formatNumber(max) };

  return (
    <>
      {length >= max * SHOW_AT && (
        <p
          aria-hidden="true"
          data-testid="message-length"
          className={cn(
            'px-3 pb-1 text-xs',
            tooLong ? 'text-text-destructive' : 'text-text-secondary',
          )}
        >
          {localize(tooLong ? 'com_ui_message_too_long' : 'com_ui_message_length', counts)}
        </p>
      )}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {tooLong ? localize('com_ui_message_over_limit', { 0: counts[1] }) : ''}
      </span>
    </>
  );
}

export default memo(MessageLength);
