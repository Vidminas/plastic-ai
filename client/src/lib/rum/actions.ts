import type { HyperDXActionClient, RumActionAttributes } from './diagnostics';

/** Curated user actions recorded as named RUM events. */
export const UI_ACTIONS = [
  'message.send',
  'message.stop',
  'message.regenerate',
  'message.continue',
  'message.edit',
  'message.copy',
  'message.feedback',
  'model.switch',
  'agent.switch',
  'file.upload',
  'file.uploaded',
  'file.upload_failed',
  'file.download',
  'question.answer',
  'conversation.new',
] as const;

export type UiAction = (typeof UI_ACTIONS)[number];

/** Identifiers and enums only: never message text, file names or UI labels. */
export type UiActionAttributes = Record<string, string | number | boolean | null | undefined>;

let actionClient: HyperDXActionClient | undefined;

export function setActionClient(client: HyperDXActionClient | undefined): void {
  actionClient = client;
}

function definedAttributes(attributes: UiActionAttributes): RumActionAttributes {
  const output: RumActionAttributes = {};
  for (const key in attributes) {
    const value = attributes[key];
    if (value != null && value !== '') {
      output[key] = value;
    }
  }
  return output;
}

/** No-op until RUM has initialized, so call sites need no feature check. */
export function trackAction(name: UiAction, attributes?: UiActionAttributes): void {
  if (!actionClient) {
    return;
  }

  try {
    actionClient.addAction(name, attributes ? definedAttributes(attributes) : undefined);
  } catch {
    /* Diagnostics should never affect app behavior. */
  }
}

/** The conversation in the address bar, for actions whose call site has none. */
function conversationIdFromPath(): string | undefined {
  const match = /^\/c\/([^/]+)/.exec(window.location.pathname);
  return match && match[1] !== 'new' ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Records a file saved from a chat, by its extension, never its name. The conversation is the
 * one open unless the caller names another (an export from the sidebar).
 */
export function trackDownload(filename: string | undefined, conversationId?: string | null): void {
  const extension = /\.([a-z0-9]{1,10})$/i.exec(filename ?? '')?.[1]?.toLowerCase();
  trackAction('file.download', {
    fileType: extension,
    conversationId: conversationId ?? conversationIdFromPath(),
  });
}
