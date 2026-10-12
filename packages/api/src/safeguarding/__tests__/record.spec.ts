import { logger } from '@librechat/data-schemas';
import { PublishCommand } from '@aws-sdk/client-sns';
import { createSnsAlertPublisher, formatSafeguardingAlert } from '../alert';
import { createSafeguardingReporter } from '../record';

const participant = { userId: 'u1', studyId: 'f3a1-sub' };
const blocked = {
  severity: 'block' as const,
  detections: [
    {
      type: 'content' as const,
      name: 'VIOLENCE',
      confidence: 'HIGH',
      severity: 'block' as const,
    },
    { type: 'word' as const, name: 'custom', severity: 'flag' as const },
  ],
};

describe('formatSafeguardingAlert', () => {
  it('names the participant by IDs, the source, the blocking filters and the severity', () => {
    const { subject, message } = formatSafeguardingAlert({
      participant,
      source: 'response',
      detections: blocked.detections,
      at: new Date('2026-10-12T10:00:00Z'),
    });
    expect(subject).toBe('Safeguarding alert (plastic-ai): content blocked');
    expect(message).toBe(
      [
        'Safeguarding alert (plastic-ai)',
        '',
        'Participant: f3a1-sub (app user u1)',
        "Screened: the assistant's response",
        'Triggered: content filter: VIOLENCE (HIGH confidence)',
        'Severity: strong (content blocked)',
        'Time: 2026-10-12T10:00:00.000Z',
      ].join('\n'),
    );
  });
});

it("names the model's own filter in an alert", () => {
  const { message } = formatSafeguardingAlert({
    participant,
    source: 'response',
    detections: [{ type: 'model', name: 'MODEL_FILTER', severity: 'block' }],
  });
  expect(message).toContain("Triggered: the model's own safety filter\n");
});

describe('createSnsAlertPublisher', () => {
  it('publishes to the topic', async () => {
    const send = jest.fn().mockResolvedValue({});
    await createSnsAlertPublisher({ client: { send } as never, topicArn: 'arn:topic' }).publish({
      subject: 's',
      message: 'm',
    });
    const command = send.mock.calls[0][0] as PublishCommand;
    expect(command).toBeInstanceOf(PublishCommand);
    expect(command.input).toEqual({ TopicArn: 'arn:topic', Subject: 's', Message: 'm' });
  });
});

describe('createSafeguardingReporter', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });
  afterEach(() => jest.restoreAllMocks());

  const event = { source: 'prompt' as const, participant, conversationId: 'c1', messageId: 'm1' };

  it('logs a blocked detection with IDs and alerts the leads', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    await createSafeguardingReporter({ alerts: { publish } }).report(blocked, event);
    expect(warn).toHaveBeenCalledWith('[safeguarding] Content blocked', {
      source: 'prompt',
      conversationId: 'c1',
      messageId: 'm1',
      userId: 'u1',
      studyId: 'f3a1-sub',
      severity: 'block',
      filters: 'content:VIOLENCE:HIGH,word:custom',
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('logs a flag without alerting, and nothing at all for no detections', async () => {
    const publish = jest.fn();
    const reporter = createSafeguardingReporter({ alerts: { publish } });
    await reporter.report({ severity: 'flag', detections: [blocked.detections[1]] }, event);
    expect(warn).toHaveBeenCalledWith('[safeguarding] Content flagged', expect.any(Object));
    await reporter.report({ severity: 'none', detections: [] }, event);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps a record of each detection in the sink, without the content', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    await createSafeguardingReporter({ sink: { write } }).report(blocked, event);
    expect(write).toHaveBeenCalledWith({
      source: 'prompt',
      conversationId: 'c1',
      messageId: 'm1',
      severity: 'block',
      userId: 'u1',
      studyId: 'f3a1-sub',
      filters: 'content:VIOLENCE:HIGH,word:custom',
    });
  });

  it('logs, rather than throws, an alert that fails', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('denied'));
    await expect(
      createSafeguardingReporter({ alerts: { publish } }).report(blocked, event),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      '[safeguarding] Could not send an alert',
      expect.any(Object),
    );
  });
});
