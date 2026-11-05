import { EventEmitter } from 'events';
import {
  answerEvents,
  pendingAskOf,
  createAgencyAnswerRecorder,
  createAgencyEventRecorder,
  withClassifierSpans,
} from '../events';

const options = [
  { label: 'Make a plan', value: 'plan' },
  { label: 'Show options', value: 'options' },
];

describe('answerEvents', () => {
  it('counts a chosen option as offered and selected, with its label', () => {
    expect(answerEvents([{ id: 'clarify', options }], { clarify: 'plan' })).toEqual([
      { type: 'options_offered' },
      { type: 'option_selected', detail: 'Make a plan' },
    ]);
  });

  it('counts a free-form answer as offered only', () => {
    expect(answerEvents([{ id: 'clarify', options }], { clarify: 'something else' })).toEqual([
      { type: 'options_offered' },
    ]);
  });

  it('ignores questions without options', () => {
    expect(answerEvents([{ id: 'name' }], { name: 'Sam' })).toEqual([]);
  });

  it('resolves a goal check with the outcome, and not with free text', () => {
    expect(answerEvents([{ id: 'goal_check', options }], { goal_check: 'refocus' })).toEqual([
      { type: 'goal_check_offered' },
      { type: 'goal_check_resolved', detail: 'refocus' },
    ]);
    expect(answerEvents([{ id: 'goal_check' }], { goal_check: 'hmm' })).toEqual([
      { type: 'goal_check_offered' },
    ]);
  });
});

describe('pendingAskOf', () => {
  it('reads only an ask_user_question batch', () => {
    expect(pendingAskOf(null)).toBeNull();
    expect(
      pendingAskOf({ metadata: { pendingAction: { payload: { type: 'tool_approval' } } } }),
    ).toBeNull();
  });
});

describe('createAgencyEventRecorder', () => {
  it('swallows a failed write', async () => {
    const recordAgencyEvent = jest.fn().mockRejectedValue(new Error('down'));
    createAgencyEventRecorder({ recordAgencyEvent }).event({ userId: 'u', type: 'recap_viewed' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recordAgencyEvent).toHaveBeenCalled();
  });
});

describe('createAgencyAnswerRecorder', () => {
  const setup = (statusCode: number) => {
    const record = { event: jest.fn() };
    const middleware = createAgencyAnswerRecorder({
      getJob: jest.fn().mockResolvedValue({
        metadata: {
          responseMessageId: 'm1',
          pendingAction: {
            payload: { type: 'ask_user_question', questions: [{ id: 'clarify', options }] },
          },
        },
      }),
      record,
    });
    const res = Object.assign(new EventEmitter(), { statusCode });
    const req = {
      config: { agency: { recap: true } },
      user: { id: 'u1' },
      body: { conversationId: 'c1', answers: { clarify: 'options' } },
    };
    return { record, middleware, req, res };
  };

  it('records the answer once the resume is accepted', async () => {
    const { record, middleware, req, res } = setup(200);
    const next = jest.fn();
    await middleware(req as never, res as never, next);
    expect(next).toHaveBeenCalled();
    res.emit('finish');
    expect(record.event).toHaveBeenCalledWith({
      userId: 'u1',
      conversationId: 'c1',
      messageId: 'm1',
      type: 'option_selected',
      detail: 'Show options',
    });
  });

  it('records nothing when the resume is refused', async () => {
    const { record, middleware, req, res } = setup(409);
    await middleware(req as never, res as never, jest.fn());
    res.emit('finish');
    expect(record.event).not.toHaveBeenCalled();
  });
});

describe('withClassifierSpans', () => {
  const classified = {
    userId: 'u1',
    conversationId: 'c1',
    messageId: 'm1',
    type: 'signal_classified' as const,
    detail: 'reject',
    classifierVersion: 'abc',
  };

  it('sends what the classifier records, by id and label, as well as recording it', () => {
    const event = jest.fn();
    const send = jest.fn().mockResolvedValue(undefined);
    withClassifierSpans({ event }, send).event(classified);
    expect(event).toHaveBeenCalledWith(classified);
    expect(send).toHaveBeenCalledWith({
      name: 'agency.signal_classified',
      scope: 'agency',
      attributes: {
        userId: 'u1',
        conversationId: 'c1',
        messageId: 'm1',
        label: 'reject',
        classifierVersion: 'abc',
      },
    });
  });

  it('leaves other events to the recorder', () => {
    const send = jest.fn().mockResolvedValue(undefined);
    withClassifierSpans({ event: jest.fn() }, send).event({
      userId: 'u1',
      type: 'goal_set',
      detail: 'A goal in the learner words',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('still records when the collector fails, or is not configured', async () => {
    const event = jest.fn();
    withClassifierSpans({ event }, jest.fn().mockRejectedValue(new Error('down'))).event(
      classified,
    );
    await new Promise(setImmediate);
    expect(event).toHaveBeenCalledTimes(1);
    const recorder = { event };
    expect(withClassifierSpans(recorder, undefined)).toBe(recorder);
  });
});
