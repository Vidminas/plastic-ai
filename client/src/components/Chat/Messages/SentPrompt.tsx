import { useState } from 'react';
import { useAtom } from 'jotai';
import copy from 'copy-to-clipboard';
import { ScrollText } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import type { TMessage, TSentPrompt } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useGetStartupConfig, useSentPromptQuery } from '~/data-provider';
import { sentPromptOpenFamily } from '~/store/sentPrompt';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const panelIdOf = (messageId: string) => `sent-prompt-${messageId}`;
const buttonIdOf = (messageId: string) => `sent-prompt-button-${messageId}`;

/** Whether `message` is one of the user's own, with `interface.sentPrompt` on. */
function useShowsSentPrompt(message: TMessage): boolean {
  const { data: startupConfig } = useGetStartupConfig();
  return (
    startupConfig?.interface?.sentPrompt === true &&
    message.isCreatedByUser === true &&
    !!message.conversationId &&
    !!message.messageId
  );
}

export type SentPromptButtonProps = {
  id: string;
  title: string;
  icon: ReactNode;
  isActive: boolean;
  ariaExpanded: boolean;
  ariaControls?: string;
  onClick: () => void;
};

/**
 * The hover action on a sent message that shows, under it, what it sent the model. The toolbar
 * draws the button (`renderButton`), so it matches the actions beside it.
 */
export function SentPromptButton({
  message,
  renderButton,
}: {
  message: TMessage;
  renderButton: (props: SentPromptButtonProps) => ReactNode;
}) {
  const localize = useLocalize();
  const shows = useShowsSentPrompt(message);
  const [open, setOpen] = useAtom(sentPromptOpenFamily(message.messageId));
  if (!shows) {
    return null;
  }
  return (
    <>
      {renderButton({
        id: buttonIdOf(message.messageId),
        title: localize(open ? 'com_ui_sent_prompt_hide' : 'com_ui_sent_prompt_show'),
        icon: <ScrollText className="size-[1.1875rem]" aria-hidden="true" />,
        isActive: open,
        ariaExpanded: open,
        ariaControls: open ? panelIdOf(message.messageId) : undefined,
        onClick: () => setOpen(!open),
      })}
    </>
  );
}

function SentPromptBody({ sentPrompt }: { sentPrompt: TSentPrompt }) {
  const localize = useLocalize();
  const [copied, setCopied] = useState(false);
  const { system, message, historyCount, tools, truncated } = sentPrompt;
  const details = [
    localize('com_ui_sent_prompt_history', { count: historyCount }),
    tools.length > 0 ? localize('com_ui_sent_prompt_tools', { 0: tools.join(', ') }) : null,
  ].filter(Boolean);
  const onCopy = () => {
    copy([system, message].filter(Boolean).join('\n\n'), { format: 'text/plain' });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs">{details.join(' · ')}</p>
        <Button variant="ghost" size="compact" type="button" onClick={onCopy}>
          {localize(copied ? 'com_ui_copied_to_clipboard' : 'com_ui_copy_to_clipboard')}
        </Button>
      </div>
      {system && (
        <section className="flex flex-col gap-1">
          <h3 className="text-text-primary text-xs font-semibold">
            {localize('com_ui_sent_prompt_instructions')}
          </h3>
          <pre className="font-mono text-xs whitespace-pre-wrap">{system}</pre>
        </section>
      )}
      <section className="flex flex-col gap-1">
        <h3 className="text-text-primary text-xs font-semibold">
          {localize('com_ui_sent_prompt_message')}
        </h3>
        <pre className="font-mono text-xs whitespace-pre-wrap">{message}</pre>
      </section>
      {truncated && <p className="text-xs italic">{localize('com_ui_sent_prompt_truncated')}</p>}
    </>
  );
}

/**
 * What a sent message sent the model, under it while its hover action is on: the system content,
 * the message as the model received it, how many earlier messages went with it and the tools
 * offered. Read each time it is shown; Escape closes it.
 */
export function SentPromptPanel({ message }: { message: TMessage }) {
  const localize = useLocalize();
  const shows = useShowsSentPrompt(message);
  const [open, setOpen] = useAtom(sentPromptOpenFamily(message.messageId));
  const query = useSentPromptQuery(message.conversationId, message.messageId, {
    enabled: shows && open,
  });
  if (!shows || !open) {
    return null;
  }
  const notKept = (query.error as { response?: { status?: number } } | null)?.response?.status;

  const close = () => {
    setOpen(false);
    document.getElementById(buttonIdOf(message.messageId))?.focus();
  };

  return (
    <div
      id={panelIdOf(message.messageId)}
      role="region"
      aria-label={localize('com_ui_sent_prompt_title')}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
      className={cn(
        'border-border-light mt-2 flex max-h-96 w-full flex-col gap-3 overflow-y-auto rounded-lg border',
        'bg-surface-secondary text-text-secondary p-3 text-left',
      )}
    >
      {query.isLoading && (
        <div role="status" className="flex justify-center">
          <Spinner className="size-4" aria-label={localize('com_ui_loading')} />
        </div>
      )}
      {query.isError && notKept === 404 && (
        <p className="text-xs">{localize('com_ui_sent_prompt_missing')}</p>
      )}
      {query.isError && notKept !== 404 && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span>{localize('com_ui_sent_prompt_error')}</span>
          <Button variant="outline" size="compact" type="button" onClick={() => query.refetch()}>
            {localize('com_ui_retry')}
          </Button>
        </div>
      )}
      {query.data && <SentPromptBody sentPrompt={query.data.sentPrompt} />}
    </div>
  );
}
