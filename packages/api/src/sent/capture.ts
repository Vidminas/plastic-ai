import { logger } from '@librechat/data-schemas';
import { SENT_PROMPT_TEXT_MAX } from 'librechat-data-provider';
import type { TSentPrompt } from 'librechat-data-provider';
import { getSafeErrorMetadata } from '~/utils/errors';

type SentSnapshot = Omit<TSentPrompt, 'createdAt'>;

type MessageLike = {
  content?: unknown;
  type?: unknown;
  role?: unknown;
  getType?: () => string;
  _getType?: () => string;
};

type ContentPart = {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  filename?: unknown;
  document?: { name?: unknown };
};

/** The graph node of the agent's own model calls, as the agents SDK names it. */
const AGENT_NODE = 'agent=';

function roleOf(message: MessageLike): string {
  if (typeof message.getType === 'function') {
    return message.getType();
  }
  if (typeof message._getType === 'function') {
    return message._getType();
  }
  const role = message.type ?? message.role;
  return typeof role === 'string' ? role : '';
}

const isSystem = (role: string) => role === 'system' || role === 'developer';
const isHuman = (role: string) => role === 'human' || role === 'user';

/** A content part as text: its text, or a short marker for what it carried instead. */
function partText(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }
  if (part == null || typeof part !== 'object') {
    return '';
  }
  const { type, text, name, filename, document } = part as ContentPart;
  if (typeof text === 'string' && (type == null || type === 'text')) {
    return text;
  }
  if (type === 'image_url' || type === 'image') {
    return '[image]';
  }
  const label = [name, filename, document?.name].find((value) => typeof value === 'string');
  if (type === 'document' || type === 'file' || type === 'input_file') {
    return label ? `[file: ${label}]` : '[file]';
  }
  if (type === 'cachePoint' || type === 'cache_point') {
    return '';
  }
  return typeof type === 'string' ? `[${type}]` : '';
}

function textOf(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map(partText).filter(Boolean).join('\n');
  }
  return partText(content);
}

type ToolLike = { name?: unknown; function?: { name?: unknown }; toolSpec?: { name?: unknown } };

/** The tool names a model call offered, from its invocation parameters, in any provider's shape. */
function toolNames(extraParams: unknown): string[] {
  const params = (extraParams as { invocation_params?: Record<string, unknown> } | undefined)
    ?.invocation_params;
  const tools =
    params?.tools ?? (params?.toolConfig as { tools?: unknown } | undefined)?.tools ?? [];
  if (!Array.isArray(tools)) {
    return [];
  }
  const names = (tools as ToolLike[])
    .map((tool) => tool?.name ?? tool?.function?.name ?? tool?.toolSpec?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  return [...new Set(names)];
}

/** What one model call sent: its system content, the last user message, and the rest counted. */
export function snapshotOf(messages: unknown, extraParams?: unknown): SentSnapshot {
  const list = (Array.isArray(messages) ? messages.flat() : []) as MessageLike[];
  const roles = list.map((message) => roleOf(message ?? {}));
  let lastHuman = -1;
  roles.forEach((role, index) => {
    if (isHuman(role)) {
      lastHuman = index;
    }
  });
  const systemParts = list
    .filter((_message, index) => isSystem(roles[index]))
    .map((message) => textOf(message?.content))
    .filter(Boolean);
  const system = systemParts.join('\n\n');
  const message = lastHuman === -1 ? '' : textOf(list[lastHuman]?.content);
  const historyCount = roles.filter((role, index) => !isSystem(role) && index !== lastHuman).length;
  return {
    system: system.slice(0, SENT_PROMPT_TEXT_MAX),
    message: message.slice(0, SENT_PROMPT_TEXT_MAX),
    historyCount,
    tools: toolNames(extraParams),
    truncated: system.length > SENT_PROMPT_TEXT_MAX || message.length > SENT_PROMPT_TEXT_MAX,
  };
}

/** Whether a model call is the agent answering, rather than summarizing or routing. */
function isAgentCall(metadata: unknown): boolean {
  const node = (metadata as { langgraph_node?: unknown } | undefined)?.langgraph_node;
  return typeof node !== 'string' || node.startsWith(AGENT_NODE);
}

/**
 * A model callback that keeps what the turn's first agent call sent, the one that answers the
 * user's message, through `onCapture`. Later calls (tool loops, handoffs, parallel agents) and
 * calls that are not the agent's (summaries) are left alone. The snapshot is taken as the call
 * starts but kept only once that call ends: a call a content filter refuses at its start, or
 * one that fails, keeps nothing. It never throws into the run.
 */
export function createSentPromptCallback({
  onCapture,
}: {
  onCapture: (snapshot: SentSnapshot) => void;
}): {
  name: string;
  handleChatModelStart: (...args: unknown[]) => void;
  handleLLMEnd: (output: unknown, runId: string) => void;
  handleLLMError: (error: unknown, runId: string) => void;
} {
  let captured = false;
  let pending: { runId: unknown; snapshot: SentSnapshot } | null = null;
  return {
    name: 'librechat-sent-prompt',
    handleChatModelStart: (...args: unknown[]) => {
      const [, messages, runId, , extraParams, , metadata] = args;
      if (captured || !isAgentCall(metadata)) {
        return;
      }
      try {
        pending = { runId, snapshot: snapshotOf(messages, extraParams) };
      } catch (error) {
        logger.warn('[sent] Could not keep what the turn sent', getSafeErrorMetadata(error));
      }
    },
    handleLLMEnd: (_output, runId) => {
      if (captured || pending == null || pending.runId !== runId) {
        return;
      }
      captured = true;
      const { snapshot } = pending;
      pending = null;
      try {
        onCapture(snapshot);
      } catch (error) {
        logger.warn('[sent] Could not keep what the turn sent', getSafeErrorMetadata(error));
      }
    },
    handleLLMError: (_error, runId) => {
      if (pending?.runId === runId) {
        pending = null;
      }
    },
  };
}

export type SentPromptRecord = SentSnapshot & {
  user: string;
  conversationId: string;
  messageId: string;
};

/**
 * The model callbacks that keep what this turn sends, for `interface.sentPrompt`: none while it
 * is off, when the turn has no new user message to keep it with, or in a temporary chat, whose
 * messages expire by themselves where these records would not. Saving runs in the background,
 * and a failure is logged without the text.
 */
export function sentPromptCallbacks({
  config,
  user,
  conversationId,
  messageId,
  isTemporary = false,
  saveSentPrompt,
}: {
  config?: { interfaceConfig?: { sentPrompt?: boolean } };
  user?: string;
  conversationId?: string | null;
  messageId?: string | null;
  isTemporary?: boolean;
  saveSentPrompt: (record: SentPromptRecord) => Promise<void>;
}): Array<ReturnType<typeof createSentPromptCallback>> {
  if (
    config?.interfaceConfig?.sentPrompt !== true ||
    isTemporary ||
    !user ||
    !conversationId ||
    !messageId
  ) {
    return [];
  }
  return [
    createSentPromptCallback({
      onCapture: (snapshot) => {
        void saveSentPrompt({ ...snapshot, user, conversationId, messageId }).catch(
          (error: unknown) =>
            logger.warn('[sent] Could not save what the turn sent', getSafeErrorMetadata(error)),
        );
      },
    }),
  ];
}
