import { ErrorTypes } from 'librechat-data-provider';
import type { TSafeguardingErrorInfo } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '@librechat/data-schemas';
import { getReferencedQuotes, mergeQuotedText } from '~/utils/quotes';
import { getBoundedAskUserAnswerValues } from '~/agents/hitl/resume';
import { participantOf, screenForSafeguarding } from './service';
import { maskUserText } from '~/guardrails/stored';

type ChatBody = {
  text?: unknown;
  answer?: unknown;
  answers?: unknown;
  quotes?: unknown;
  decisions?: unknown;
  messageId?: unknown;
  conversationId?: unknown;
  responseMessageId?: unknown;
};

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * What a participant wrote in a chat or resume request, as the model will read it: the
 * message with its quoted excerpts, a free-form answer to the model's question, the chosen
 * answers, and the text of a tool decision. `source` is `prompt` for a message, else `answer`.
 */
export function getParticipantText(body: ChatBody): { text: string; source: 'prompt' | 'answer' } {
  const parts: string[] = [];
  const typed = [body.text, body.answer].find(nonEmpty) ?? '';
  const quotes = getReferencedQuotes(body.quotes);
  const message = quotes == null ? typed : mergeQuotedText(typed, quotes);
  if (message) {
    parts.push(message);
  }
  if (body.answers != null && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
    parts.push(...getBoundedAskUserAnswerValues(body.answers).filter(nonEmpty));
  }
  if (Array.isArray(body.decisions)) {
    for (const decision of body.decisions as Array<Record<string, unknown>>) {
      for (const value of [decision?.responseText, decision?.reason]) {
        if (nonEmpty(value)) {
          parts.push(value);
        }
      }
    }
  }
  return { text: parts.join('\n\n'), source: nonEmpty(body.text) ? 'prompt' : 'answer' };
}

type SafeguardedRequest = Request & {
  body: ChatBody;
  config?: Partial<AppConfig>;
  user?: { id?: string; openidId?: string };
};

type Deny = (
  req: Request,
  res: Response,
  error: { type: ErrorTypes.SAFEGUARDING; info: TSafeguardingErrorInfo },
) => Promise<unknown>;

type SafeguardingCheckMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

/**
 * Chat route middleware that screens what a participant wrote (`getParticipantText`) with
 * `safeguarding` before anything reaches a model. Text is masked first (`piiMasking`), so
 * personal identifiers never reach the screening guardrail. Blocked text, or text that could
 * not be screened, is refused through `deny`, which shows the reason in the conversation, as
 * moderation does; its message is stored masked.
 */
export function createSafeguardingCheck({ deny }: { deny: Deny }): SafeguardingCheckMiddleware {
  return async function safeguardingCheck(req, res, next) {
    const request = req as SafeguardedRequest;
    if (request.config?.safeguarding == null || !request.user?.id) {
      return next();
    }
    const { text, source } = getParticipantText(request.body ?? {});
    if (!text.trim()) {
      return next();
    }
    const body = request.body;
    const check = await screenForSafeguarding({
      appConfig: request.config,
      text: await maskUserText(request.config, text),
      event: {
        source,
        participant: participantOf(request.user),
        ...(nonEmpty(body.conversationId) ? { conversationId: body.conversationId } : {}),
        ...(nonEmpty(body.messageId) ? { messageId: body.messageId } : {}),
      },
      ...(nonEmpty(body.responseMessageId) ? { traceMessageId: body.responseMessageId } : {}),
    });
    if (check.ok) {
      return next();
    }
    if (nonEmpty(body.text)) {
      body.text = await maskUserText(request.config, body.text);
    }
    return deny(req, res, { type: ErrorTypes.SAFEGUARDING, info: check.info });
  };
}
