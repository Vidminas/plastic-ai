import { screenForSafeguarding } from '~/safeguarding/service';
import { createAgencyHandlers } from '../handlers';

/** Stands in for the PII guardrail: digits are the "identifiers" it masks. */
jest.mock('~/guardrails/stored', () => ({
  maskUserText: jest.fn(async (_config: unknown, text: string) => text.replace(/\d/g, '#')),
}));

jest.mock('~/safeguarding/service', () => ({
  participantOf: jest.fn(() => ({ userId: 'u1' })),
  screenForSafeguarding: jest.fn(),
}));

const allOn = {
  intentions: true,
  conversationGoal: true,
  goalChecks: true,
  recap: true,
  goalSuggestions: [{ id: 'exams', title: 'Prepare for exams', icon: 'book' }],
};
const makeDeps = () => ({
  getAgencyIntentions: jest.fn().mockResolvedValue(null),
  setAgencyIntentions: jest.fn().mockImplementation(async (_u, update) => update),
  getConversationGoal: jest.fn().mockResolvedValue({ text: 'g' }),
  setConversationGoal: jest.fn().mockImplementation(async (_u, _c, text) => ({ text })),
  getAgencyRecap: jest.fn().mockResolvedValue({ goals: { set: 0, conversations: 0 } }),
  getConvo: jest.fn().mockResolvedValue({ conversationId: 'c1' }),
  record: { event: jest.fn() },
});

type MockRes = {
  statusCode: number;
  body: unknown;
  status: jest.Mock;
  json: jest.Mock;
  end: jest.Mock;
};

const makeRes = (): MockRes => {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status: jest.fn(),
    json: jest.fn(),
    end: jest.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end.mockReturnValue(res);
  return res;
};

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1' },
  config: { agency: allOn },
  params: {},
  query: {},
  body: {},
  ...overrides,
});

describe('createAgencyHandlers', () => {
  it('answers 404 while the feature is off and 401 without a user', async () => {
    const handlers = createAgencyHandlers(makeDeps());
    const off = makeRes();
    await handlers.getRecap(
      makeReq({ config: { agency: { ...allOn, recap: false } } }) as never,
      off as never,
    );
    expect(off.statusCode).toBe(404);

    const anonymous = makeRes();
    await handlers.getRecap(makeReq({ user: undefined }) as never, anonymous as never);
    expect(anonymous.statusCode).toBe(401);
  });

  it('validates and saves intentions, recording the update', async () => {
    const deps = makeDeps();
    const handlers = createAgencyHandlers(deps);

    const bad = makeRes();
    await handlers.putIntentions(
      makeReq({ body: { factors: { guiding: 9 } } }) as never,
      bad as never,
    );
    expect(bad.statusCode).toBe(400);

    const ok = makeRes();
    await handlers.putIntentions(
      makeReq({ body: { goals: 'stats', factors: { guiding: 4 } } }) as never,
      ok as never,
    );
    expect(deps.setAgencyIntentions).toHaveBeenCalledWith('u1', {
      goals: 'stats',
      intendedUse: '',
      commitments: '',
      factors: { guiding: 4 },
    });
    expect(deps.record.event).toHaveBeenCalledWith({ userId: 'u1', type: 'intentions_updated' });
  });

  it("refuses a goal for a conversation the user doesn't have", async () => {
    const deps = makeDeps();
    deps.getConvo.mockResolvedValue(null);
    const res = makeRes();
    await createAgencyHandlers(deps).putGoal(
      makeReq({ params: { conversationId: 'c1' }, body: { text: 'goal' } }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(404);
    expect(deps.setConversationGoal).not.toHaveBeenCalled();
  });

  it('refuses a goal safeguarding blocks, with the reasons', async () => {
    const deps = makeDeps();
    const info = { source: 'prompt', reasons: [{ type: 'topic', name: 'self-harm' }] };
    (screenForSafeguarding as jest.Mock).mockResolvedValue({ ok: false, info });
    const res = makeRes();
    await createAgencyHandlers(deps).putGoal(
      makeReq({
        config: { agency: allOn, safeguarding: {} },
        params: { conversationId: 'c1' },
        body: { text: 'goal' },
      }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ type: 'safeguarding', info });
    expect(deps.setConversationGoal).not.toHaveBeenCalled();
    expect(screenForSafeguarding).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ source: 'goal', conversationId: 'c1' }),
      }),
    );
  });

  describe('intentions screening', () => {
    const body = {
      goals: 'pass stats, call 07700900123',
      intendedUse: 'planning',
      commitments: '',
      factors: { guiding: 4 },
    };
    const withSafeguarding = (overrides: Record<string, unknown> = {}) =>
      makeReq({ config: { agency: allOn, safeguarding: {} }, body, ...overrides });

    it('masks the text and screens it, as intentions, before saving', async () => {
      const deps = makeDeps();
      (screenForSafeguarding as jest.Mock).mockResolvedValue({ ok: true });
      const res = makeRes();
      await createAgencyHandlers(deps).putIntentions(withSafeguarding() as never, res as never);

      expect(screenForSafeguarding).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'pass stats, call ###########\n\nplanning',
          event: expect.objectContaining({ source: 'intentions' }),
        }),
      );
      expect(deps.setAgencyIntentions).toHaveBeenCalledWith('u1', {
        goals: 'pass stats, call ###########',
        intendedUse: 'planning',
        commitments: '',
        factors: { guiding: 4 },
      });
    });

    it('masks intentions even where safeguarding is off', async () => {
      const deps = makeDeps();
      await createAgencyHandlers(deps).putIntentions(
        makeReq({ body }) as never,
        makeRes() as never,
      );
      expect(deps.setAgencyIntentions).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ goals: 'pass stats, call ###########' }),
      );
    });

    it('refuses intentions safeguarding blocks, saving nothing', async () => {
      const deps = makeDeps();
      const info = { source: 'intentions', reasons: [{ type: 'topic', name: 'self-harm' }] };
      (screenForSafeguarding as jest.Mock).mockResolvedValue({ ok: false, info });
      const res = makeRes();
      await createAgencyHandlers(deps).putIntentions(withSafeguarding() as never, res as never);

      expect(res.statusCode).toBe(422);
      expect(res.body).toEqual({ type: 'safeguarding', info });
      expect(deps.setAgencyIntentions).not.toHaveBeenCalled();
      expect(deps.record.event).not.toHaveBeenCalled();
    });

    it('answers 503, saving nothing, when the text cannot be screened', async () => {
      const deps = makeDeps();
      const info = { source: 'intentions', reasons: [], unavailable: true };
      (screenForSafeguarding as jest.Mock).mockResolvedValue({ ok: false, info });
      const res = makeRes();
      await createAgencyHandlers(deps).putIntentions(withSafeguarding() as never, res as never);

      expect(res.statusCode).toBe(503);
      expect(deps.setAgencyIntentions).not.toHaveBeenCalled();
    });
  });

  it('saves an updated goal and records it', async () => {
    const deps = makeDeps();
    const res = makeRes();
    await createAgencyHandlers(deps).putGoal(
      makeReq({ params: { conversationId: 'c1' }, body: { text: ' new goal ' } }) as never,
      res as never,
    );
    expect(deps.setConversationGoal).toHaveBeenCalledWith('u1', 'c1', 'new goal', undefined);
    expect(res.body).toEqual({ goal: { text: 'new goal' } });
    expect(deps.record.event).toHaveBeenCalledWith({
      userId: 'u1',
      conversationId: 'c1',
      type: 'goal_updated',
    });
  });

  it('accepts only the events the browser reports', async () => {
    const deps = makeDeps();
    const handlers = createAgencyHandlers(deps);
    const bad = makeRes();
    await handlers.postEvent(makeReq({ body: { type: 'goal_set' } }) as never, bad as never);
    expect(bad.statusCode).toBe(400);

    const ok = makeRes();
    await handlers.postEvent(
      makeReq({ body: { type: 'goal_skipped', conversationId: 'new' } }) as never,
      ok as never,
    );
    expect(ok.statusCode).toBe(204);
    expect(deps.record.event).toHaveBeenCalledWith({
      userId: 'u1',
      type: 'goal_skipped',
      conversationId: 'new',
    });
  });

  it('answers 500 without the error text when a read fails', async () => {
    const deps = makeDeps();
    deps.getAgencyRecap.mockRejectedValue(new Error('secret detail'));
    const res = makeRes();
    await createAgencyHandlers(deps).getRecap(makeReq() as never, res as never);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('keeps the suggested goal a goal started from, refusing an unknown one', async () => {
    const deps = makeDeps();
    const handlers = createAgencyHandlers(deps);
    const req = makeReq({
      params: { conversationId: 'c1' },
      body: { text: 'Revise algebra', suggestionId: 'exams' },
    });
    await handlers.putGoal(req as never, makeRes() as never);
    expect(deps.setConversationGoal).toHaveBeenCalledWith('u1', 'c1', 'Revise algebra', 'exams');

    const unknown = makeRes();
    await handlers.putGoal(
      makeReq({
        params: { conversationId: 'c1' },
        body: { text: 'Fly', suggestionId: 'flying' },
      }) as never,
      unknown as never,
    );
    expect(unknown.statusCode).toBe(400);
  });
});
