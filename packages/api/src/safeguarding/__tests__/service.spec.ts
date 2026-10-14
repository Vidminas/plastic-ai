import { logger } from '@librechat/data-schemas';
import { ErrorTypes, safeguardingSchema } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { SafeguardingAssessment } from '../assess';
import { checkModelOutput, participantOf, screenForSafeguarding } from '../service';
import { createSafeguardingCheck, getParticipantText } from '../middleware';
import * as screen from '../screen';

const safeguarding = safeguardingSchema.parse({
  guardrail: { guardrailIdentifier: 'gr', guardrailVersion: '1' },
});
const participant = { userId: 'u1', studyId: 'sub-1' };

const withScreen = (result: SafeguardingAssessment | Error) =>
  jest.spyOn(screen, 'getSafeguardingScreener').mockReturnValue({
    screen:
      result instanceof Error
        ? jest.fn().mockRejectedValue(result)
        : jest.fn().mockResolvedValue(result),
  });

describe('screenForSafeguarding', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });
  afterEach(() => jest.restoreAllMocks());

  it('lets everything through without a safeguarding config', async () => {
    const spy = withScreen({ severity: 'block', detections: [] });
    const check = await screenForSafeguarding({
      appConfig: {},
      text: 'anything',
      event: { source: 'prompt', participant },
    });
    expect(check.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('records a flag and lets the text through', async () => {
    withScreen({
      severity: 'flag',
      detections: [{ type: 'content', name: 'INSULTS', confidence: 'MEDIUM', severity: 'flag' }],
    });
    const check = await screenForSafeguarding({
      appConfig: { safeguarding },
      text: 'rude',
      event: { source: 'prompt', participant, conversationId: 'c1' },
    });
    expect(check.ok).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[safeguarding] Content flagged',
      expect.objectContaining({ source: 'prompt', userId: 'u1', conversationId: 'c1' }),
    );
  });

  it('refuses blocked text with the blocking filters as the reason', async () => {
    withScreen({
      severity: 'block',
      detections: [
        { type: 'topic', name: 'self-harm', severity: 'block' },
        { type: 'word', name: 'custom', severity: 'flag' },
      ],
    });
    const check = await screenForSafeguarding({
      appConfig: { safeguarding },
      text: 'text',
      event: { source: 'answer', participant },
    });
    expect(check).toEqual({
      ok: false,
      info: { source: 'answer', reasons: [{ type: 'topic', name: 'self-harm' }] },
    });
  });

  it('refuses unscreened text when the guardrail fails, unless onError is allow', async () => {
    withScreen(new Error('throttled'));
    const refused = await screenForSafeguarding({
      appConfig: { safeguarding },
      text: 'text',
      event: { source: 'prompt', participant },
    });
    expect(refused).toEqual({
      ok: false,
      info: { source: 'prompt', reasons: [], unavailable: true },
    });
    const allowed = await screenForSafeguarding({
      appConfig: { safeguarding: { ...safeguarding, onError: 'allow' } },
      text: 'text',
      event: { source: 'prompt', participant },
    });
    expect(allowed.ok).toBe(true);
  });
});

describe('checkModelOutput', () => {
  beforeEach(() => jest.spyOn(logger, 'warn').mockImplementation(() => logger));
  afterEach(() => jest.restoreAllMocks());

  it('returns the error info for a response the guardrail stopped', () => {
    const output = {
      response_metadata: {
        messageStop: { stopReason: 'guardrail_intervened' },
        metadata: {
          trace: {
            guardrail: {
              outputAssessments: {
                gr: [
                  {
                    contentPolicy: {
                      filters: [{ type: 'VIOLENCE', confidence: 'HIGH', action: 'BLOCKED' }],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };
    expect(
      checkModelOutput({ appConfig: { safeguarding }, output, event: { participant } }),
    ).toEqual({ source: 'response', reasons: [{ type: 'content', name: 'VIOLENCE' }] });
    expect(checkModelOutput({ appConfig: {}, output, event: { participant } })).toBeUndefined();
  });
});

describe('checkModelOutput for the model filter', () => {
  beforeEach(() => jest.spyOn(logger, 'warn').mockImplementation(() => logger));
  afterEach(() => jest.restoreAllMocks());

  it("reports a response the model's own filter stopped as blocked, by that filter", () => {
    const output = { response_metadata: { messageStop: { stopReason: 'content_filtered' } } };
    expect(
      checkModelOutput({ appConfig: { safeguarding }, output, event: { participant } }),
    ).toEqual({ source: 'response', reasons: [{ type: 'model', name: 'MODEL_FILTER' }] });
  });
});

describe('participantOf', () => {
  it('names a participant by the app user ID and Cognito username only', () => {
    expect(participantOf({ id: 'u1', openidId: 'sub-1' })).toEqual(participant);
    expect(participantOf({ _id: 'u2' })).toEqual({ userId: 'u2' });
  });
});

describe('getParticipantText', () => {
  it('joins the message with its quotes, answers and decision text', () => {
    expect(
      getParticipantText({
        text: 'my message',
        quotes: ['quoted bit'],
        decisions: [{ responseText: 'why', reason: 'because' }],
      }),
    ).toEqual({
      text: expect.stringMatching(/quoted bit[\s\S]*my message\n\nwhy\n\nbecause$/),
      source: 'prompt',
    });
    expect(getParticipantText({ answer: 'my answer' })).toEqual({
      text: 'my answer',
      source: 'answer',
    });
    expect(getParticipantText({})).toEqual({ text: '', source: 'answer' });
  });
});

describe('createSafeguardingCheck', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  });
  afterEach(() => jest.restoreAllMocks());

  const request = (config: object) =>
    ({
      body: { text: 'a message', conversationId: 'c1', messageId: 'm1' },
      config,
      user: { id: 'u1', openidId: 'sub-1' },
    }) as unknown as Request;

  it('denies blocked text with the safeguarding error', async () => {
    withScreen({
      severity: 'block',
      detections: [{ type: 'content', name: 'HATE', severity: 'block' }],
    });
    const deny = jest.fn().mockResolvedValue(undefined);
    const next = jest.fn();
    await createSafeguardingCheck({ deny })(request({ safeguarding }), {} as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(deny).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      type: ErrorTypes.SAFEGUARDING,
      info: { source: 'prompt', reasons: [{ type: 'content', name: 'HATE' }] },
    });
  });

  it('passes flagged text, and everything without a config', async () => {
    withScreen({ severity: 'flag', detections: [] });
    const deny = jest.fn();
    const next = jest.fn();
    await createSafeguardingCheck({ deny })(request({ safeguarding }), {} as Response, next);
    await createSafeguardingCheck({ deny })(request({}), {} as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(deny).not.toHaveBeenCalled();
  });
});
