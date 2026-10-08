import { ErrorTypes } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import {
  findMessageTooLong,
  checkApiMessageLength,
  getChatRequestTexts,
  getResponsesUserTexts,
  createMessageLengthLimit,
  getChatCompletionUserTexts,
} from './message';

describe('findMessageTooLong', () => {
  it('reports the first text past the limit with its length', () => {
    expect(findMessageTooLong(['short', 'x'.repeat(12)], 10)).toEqual({
      type: ErrorTypes.MESSAGE_TOO_LONG,
      length: 12,
      max: 10,
    });
  });

  it('accepts texts at the limit, and anything without one', () => {
    expect(findMessageTooLong(['x'.repeat(10)], 10)).toBeNull();
    expect(findMessageTooLong(['x'.repeat(100_000)], undefined)).toBeNull();
  });
});

describe('request texts', () => {
  it('reads the typed message and ask-user answers from a chat request', () => {
    expect(getChatRequestTexts({ text: 'hi', quotes: [{ text: 'not counted' }] })).toEqual(['hi']);
    expect(getChatRequestTexts({ answer: 'yes' })).toEqual(['yes']);
    expect(getChatRequestTexts({ answers: { q1: 'a', q2: 'b' } })).toEqual(['a', 'b']);
    expect(getChatRequestTexts(null)).toEqual([]);
  });

  it('reads every user message from a chat completions request', () => {
    const texts = getChatCompletionUserTexts([
      { role: 'system', content: 'not counted' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'not counted' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'second ' },
          { type: 'image_url', image_url: { url: 'data:' } },
          { type: 'text', text: 'part' },
        ],
      },
    ]);
    expect(texts).toEqual(['first', 'second part']);
  });

  it('reads user messages from a Responses input', () => {
    expect(getResponsesUserTexts('plain')).toEqual(['plain']);
    expect(
      getResponsesUserTexts([
        { type: 'message', role: 'developer', content: 'not counted' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'typed' }] },
      ]),
    ).toEqual(['typed']);
  });
});

describe('createMessageLengthLimit', () => {
  const run = async (body: unknown, max?: number) => {
    const deny = jest.fn().mockResolvedValue(undefined);
    const next = jest.fn() as NextFunction;
    const req = {
      body,
      config: { messageLimits: { maxUserMessageChars: max } },
    } as unknown as Request;
    await createMessageLengthLimit({ deny })(req, {} as Response, next);
    return { deny, next };
  };

  it('passes a message within the limit', async () => {
    const { deny, next } = await run({ text: 'hello' }, 10);
    expect(next).toHaveBeenCalledTimes(1);
    expect(deny).not.toHaveBeenCalled();
  });

  it('denies a message over the limit without calling the next handler', async () => {
    const { deny, next } = await run({ text: 'x'.repeat(11) }, 10);
    expect(next).not.toHaveBeenCalled();
    expect(deny).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      type: ErrorTypes.MESSAGE_TOO_LONG,
      length: 11,
      max: 10,
    });
  });

  it('passes everything when no limit is configured', async () => {
    const { deny, next } = await run({ text: 'x'.repeat(100_000) });
    expect(next).toHaveBeenCalledTimes(1);
    expect(deny).not.toHaveBeenCalled();
  });
});

describe('checkApiMessageLength', () => {
  const limits = { maxUserMessageChars: 10 };

  it('accepts requests whose user messages fit', () => {
    expect(
      checkApiMessageLength(
        { protocol: 'chat.completions', messages: [{ role: 'user', content: 'hi' }] },
        limits,
      ),
    ).toEqual({ ok: true });
    expect(
      checkApiMessageLength({ protocol: 'responses', input: 'x'.repeat(50) }, undefined),
    ).toEqual({ ok: true });
  });

  it('refuses a request with an oversized user message by stable code', () => {
    expect(checkApiMessageLength({ protocol: 'responses', input: 'x'.repeat(11) }, limits)).toEqual(
      {
        ok: false,
        error: {
          code: ErrorTypes.MESSAGE_TOO_LONG,
          message: 'A user message is 11 characters long; the limit is 10.',
        },
      },
    );
  });
});
