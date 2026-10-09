import { ErrorTypes, countMessageCharacters, exceedsMessageLength } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { TMessageLimits } from 'librechat-data-provider';
import type { InputItem } from '~/agents/responses/types';
import type { ChatMessage } from '~/agents/openai/types';
import { getBoundedAskUserAnswerValues } from '~/agents/hitl/resume';

/** The error a user sees when a message is over `messageLimits.maxUserMessageChars`. */
export interface MessageTooLongError {
  type: ErrorTypes.MESSAGE_TOO_LONG;
  /** Characters in the longest offending message. */
  length: number;
  max: number;
}

/** First text past `max`, as the error to report; null when every text fits or there's no limit. */
export function findMessageTooLong(
  texts: Iterable<string>,
  max: number | undefined,
): MessageTooLongError | null {
  if (max == null) {
    return null;
  }
  for (const text of texts) {
    if (exceedsMessageLength(text, max)) {
      return { type: ErrorTypes.MESSAGE_TOO_LONG, length: countMessageCharacters(text), max };
    }
  }
  return null;
}

/**
 * What a user wrote in a chat request: the typed message, or the answer to an ask-user
 * question when resuming. Quotes are excerpts of earlier replies and are not counted.
 */
export function getChatRequestTexts(body: unknown): string[] {
  if (body == null || typeof body !== 'object') {
    return [];
  }
  const { text, answer, answers } = body as Record<string, unknown>;
  const texts: string[] = [];
  if (typeof text === 'string') {
    texts.push(text);
  }
  if (typeof answer === 'string') {
    texts.push(answer);
  }
  texts.push(...getBoundedAskUserAnswerValues(answers));
  return texts;
}

function textParts(content: unknown, textType: string): string[] {
  if (typeof content === 'string') {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const parts: string[] = [];
  for (const part of content) {
    if (part?.type === textType && typeof part.text === 'string') {
      parts.push(part.text);
    }
  }
  return parts;
}

/** A chat completions request carries its history, so every user message is checked. */
export function getChatCompletionUserTexts(messages: ChatMessage[] | undefined): string[] {
  return (messages ?? []).flatMap((message) =>
    message?.role === 'user' ? [textParts(message.content, 'text').join('')] : [],
  );
}

/** A Responses request's input: a bare string is one user message. */
export function getResponsesUserTexts(input: string | InputItem[] | undefined): string[] {
  if (typeof input === 'string') {
    return [input];
  }
  return (input ?? []).flatMap((item) =>
    item?.type === 'message' && item.role === 'user'
      ? [textParts(item.content, 'input_text').join('')]
      : [],
  );
}

export type ApiMessageLengthResult =
  | { ok: true }
  | { ok: false; error: { code: ErrorTypes.MESSAGE_TOO_LONG; message: string } };

/**
 * Checks every user message in an OpenAI-compatible or Responses API request against
 * `messageLimits.maxUserMessageChars`. API clients have no UI to localize for, so the
 * message is plain English beside the stable code.
 */
export function checkApiMessageLength(
  request:
    | { protocol: 'chat.completions'; messages?: ChatMessage[] }
    | { protocol: 'responses'; input?: string | InputItem[] },
  limits: TMessageLimits | undefined,
): ApiMessageLengthResult {
  const texts =
    request.protocol === 'chat.completions'
      ? getChatCompletionUserTexts(request.messages)
      : getResponsesUserTexts(request.input);
  const error = findMessageTooLong(texts, limits?.maxUserMessageChars);
  if (error == null) {
    return { ok: true };
  }
  return {
    ok: false,
    error: {
      code: ErrorTypes.MESSAGE_TOO_LONG,
      message: `A user message is ${error.length} characters long; the limit is ${error.max}.`,
    },
  };
}

type RequestWithLimits = Request & { config?: { messageLimits?: TMessageLimits } };

type Deny = (req: Request, res: Response, error: MessageTooLongError) => Promise<unknown>;

type MessageLengthLimit = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Chat route middleware that refuses a message over `messageLimits.maxUserMessageChars`
 * before anything reaches a model. `deny` reports it in the conversation, as moderation does.
 */
export function createMessageLengthLimit({ deny }: { deny: Deny }): MessageLengthLimit {
  return async function messageLengthLimit(req, res, next) {
    const max = (req as RequestWithLimits).config?.messageLimits?.maxUserMessageChars;
    const error = findMessageTooLong(getChatRequestTexts(req.body), max);
    if (error == null) {
      return next();
    }
    return deny(req, res, error);
  };
}
