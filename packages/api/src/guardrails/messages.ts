import type { BaseMessage, MessageContent } from '@librechat/agents/langchain/messages';
import type { MaskText } from './mask';

/** How many texts are sent to the guardrail at once; the masker caches what it has seen. */
const CONCURRENCY = 8;

/** Messages a person or the model wrote; tool results and system prompts are left alone. */
const MASKED_MESSAGE_TYPES = new Set(['human', 'ai']);

async function mapConcurrently<T>(
  items: readonly T[],
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      await run(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

async function maskContent(content: MessageContent, maskText: MaskText): Promise<MessageContent> {
  if (typeof content === 'string') {
    return maskText(content);
  }
  return Promise.all(
    content.map(async (part) =>
      part.type === 'text' && typeof part.text === 'string'
        ? { ...part, text: await maskText(part.text) }
        : part,
    ),
  ) as Promise<MessageContent>;
}

/**
 * Masks the text of every message a person or the model wrote, in place, before an agent run
 * sends them to a model: the history as well as the new message, since history is stored as
 * written. Each message's serialized fields (`lc_kwargs`) are updated too, because a paused
 * run's checkpoint is restored from them on resume. Without a masker, does nothing.
 *
 * Throws when masking fails, so the run fails rather than send unmasked text.
 */
export async function maskModelMessages(
  messages: BaseMessage[],
  maskText: MaskText | undefined,
): Promise<BaseMessage[]> {
  if (maskText == null) {
    return messages;
  }
  const masked = messages.filter((message) => MASKED_MESSAGE_TYPES.has(message._getType()));
  await mapConcurrently(masked, async (message) => {
    const content = await maskContent(message.content, maskText);
    message.content = content;
    if (message.lc_kwargs != null && 'content' in message.lc_kwargs) {
      message.lc_kwargs.content = content;
    }
  });
  return messages;
}

/** A content part as the title flow reads it; only string text is masked. */
type TitleContentPart = { type?: string; text?: unknown };

/**
 * Masks what a title is generated from: the user's text and the text parts of the response.
 * Returns copies, so the response's own parts, which are saved, stay as written.
 */
export async function maskTitleInput<P extends TitleContentPart>(
  { inputText, contentParts }: { inputText: string; contentParts: P[] },
  maskText: MaskText | undefined,
): Promise<{ inputText: string; contentParts: P[] }> {
  if (maskText == null) {
    return { inputText, contentParts };
  }
  const [maskedInput, maskedParts] = await Promise.all([
    maskText(inputText),
    Promise.all(
      contentParts.map(async (part) =>
        part?.type === 'text' && typeof part.text === 'string'
          ? { ...part, text: await maskText(part.text) }
          : part,
      ),
    ),
  ]);
  return { inputText: maskedInput, contentParts: maskedParts };
}
