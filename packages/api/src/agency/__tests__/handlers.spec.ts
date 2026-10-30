import { logger } from '@librechat/data-schemas';
import { DEFAULT_AGENCY_PROMPT } from 'librechat-data-provider';
import { agencyStartupConfig, createAgencyHandlers } from '../handlers';
import { screenForSafeguarding } from '~/safeguarding/service';
import { maskUserText } from '~/guardrails/stored';

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
  recap: true,
  reflections: true,
  goalSuggestions: [{ id: 'exams', title: 'Prepare for exams', icon: 'book' }],
};
const makeDeps = () => ({
  getAgencyIntentions: jest.fn().mockResolvedValue(null),
  setAgencyIntentions: jest.fn().mockImplementation(async (_u, update) => update),
  getConversationGoal: jest.fn().mockResolvedValue({ text: 'g' }),
  setConversationGoal: jest.fn().mockImplementation(async (_u, _c, text) => ({ text })),
  getAgencyRecap: jest.fn().mockResolvedValue({ chats: 0 }),
  getConvo: jest.fn().mockResolvedValue({ conversationId: 'c1' }),
  listAgencyReflections: jest.fn().mockResolvedValue([]),
  createAgencyReflection: jest.fn().mockImplementation(async (_u, answers) => ({
    id: 'r1',
    answers,
    createdAt: 'a',
    updatedAt: 'a',
  })),
  updateAgencyReflection: jest.fn().mockImplementation(async (_u, id, answers) => ({
    id,
    answers,
    createdAt: 'a',
    updatedAt: 'b',
  })),
  getAgencyPrompt: jest.fn().mockResolvedValue(null),
  setAgencyPrompt: jest.fn().mockImplementation(async (_u, template) => ({
    template,
    updatedAt: 'a',
  })),
  deleteAgencyPrompt: jest.fn().mockResolvedValue(undefined),
  addAgencyPromptRevision: jest.fn().mockResolvedValue('rev1'),
  onConversationGoalChanged: jest.fn(),
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
      detail: 'new goal',
    });
  });

  it('saves the same goal again without a journey step or a relabel', async () => {
    const deps = makeDeps();
    deps.getConversationGoal.mockResolvedValue({ text: 'same goal' });
    const res = makeRes();
    await createAgencyHandlers(deps).putGoal(
      makeReq({ params: { conversationId: 'c1' }, body: { text: 'same goal' } }) as never,
      res as never,
    );
    expect(deps.setConversationGoal).toHaveBeenCalled();
    expect(res.body).toEqual({ goal: { text: 'same goal' } });
    expect(deps.record.event).not.toHaveBeenCalled();
    expect(deps.onConversationGoalChanged).not.toHaveBeenCalled();
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
    expect(deps.onConversationGoalChanged).toHaveBeenCalledWith(req, 'u1', 'c1');

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

  describe('reflections', () => {
    const answers = {
      working_on: 'History essay',
      decision: 'Asked for questions',
      reason: '',
      outcome: 'Got 7 out of 10',
      happy: '',
    };

    it('answers 404 while reflections are off', async () => {
      const res = makeRes();
      await createAgencyHandlers(makeDeps()).getReflections(
        makeReq({ config: { agency: { ...allOn, reflections: false } } }) as never,
        res as never,
      );
      expect(res.statusCode).toBe(404);
    });

    it('masks each answer, screens them together as a reflection, and records the save', async () => {
      const deps = makeDeps();
      (screenForSafeguarding as jest.Mock).mockResolvedValue({ ok: true });
      const res = makeRes();
      await createAgencyHandlers(deps).postReflection(
        makeReq({ config: { agency: allOn, safeguarding: {} }, body: { answers } }) as never,
        res as never,
      );
      expect(res.statusCode).toBe(201);
      expect(screenForSafeguarding).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'History essay\n\nAsked for questions\n\nGot # out of ##',
          event: expect.objectContaining({ source: 'reflection' }),
        }),
      );
      expect(deps.createAgencyReflection).toHaveBeenCalledWith('u1', {
        ...answers,
        outcome: 'Got # out of ##',
      });
      expect(deps.record.event).toHaveBeenCalledWith({
        userId: 'u1',
        type: 'reflection_saved',
        detail: 'r1',
      });
    });

    it('refuses an empty reflection, and one safeguarding blocks', async () => {
      const deps = makeDeps();
      const handlers = createAgencyHandlers(deps);
      const empty = makeRes();
      await handlers.postReflection(makeReq({ body: { answers: {} } }) as never, empty as never);
      expect(empty.statusCode).toBe(400);

      const info = { source: 'reflection', reasons: [{ type: 'topic', name: 'self-harm' }] };
      (screenForSafeguarding as jest.Mock).mockResolvedValue({ ok: false, info });
      const refused = makeRes();
      await handlers.postReflection(
        makeReq({ config: { agency: allOn, safeguarding: {} }, body: { answers } }) as never,
        refused as never,
      );
      expect(refused.statusCode).toBe(422);
      expect(deps.createAgencyReflection).not.toHaveBeenCalled();
    });

    it("edits a reflection of the learner's own, recording the edit", async () => {
      const deps = makeDeps();
      const handlers = createAgencyHandlers(deps);
      const id = 'c'.repeat(24);
      const res = makeRes();
      await handlers.patchReflection(
        makeReq({ params: { reflectionId: id }, body: { answers } }) as never,
        res as never,
      );
      expect(deps.updateAgencyReflection).toHaveBeenCalledWith('u1', id, {
        ...answers,
        outcome: 'Got # out of ##',
      });
      expect(deps.record.event).toHaveBeenCalledWith({
        userId: 'u1',
        type: 'reflection_updated',
        detail: id,
      });

      deps.updateAgencyReflection.mockResolvedValue(null);
      const missing = makeRes();
      await handlers.patchReflection(
        makeReq({ params: { reflectionId: id }, body: { answers } }) as never,
        missing as never,
      );
      expect(missing.statusCode).toBe(404);

      const bad = makeRes();
      await handlers.patchReflection(
        makeReq({ params: { reflectionId: 'x' }, body: { answers } }) as never,
        bad as never,
      );
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('hidden instructions', () => {
    const put = async (deps: ReturnType<typeof makeDeps>, template: unknown) => {
      const res = makeRes();
      await createAgencyHandlers(deps).putPrompt(
        makeReq({ body: { template } }) as never,
        res as never,
      );
      return res;
    };

    it('answers 404 without conversation goals', async () => {
      for (const config of [{}, { agency: { ...allOn, conversationGoal: false } }]) {
        const res = makeRes();
        await createAgencyHandlers(makeDeps()).getPrompt(
          makeReq({ config }) as never,
          res as never,
        );
        expect(res.statusCode).toBe(404);
      }
    });

    it('logs a change only once the template is saved', async () => {
      const deps = makeDeps();
      deps.setAgencyPrompt.mockRejectedValueOnce(new Error('db down'));
      const res = await put(deps, 'Be brief.');
      expect(res.statusCode).toBe(500);
      expect(deps.addAgencyPromptRevision).not.toHaveBeenCalled();
    });

    it('sends the default alongside the learner’s own, which is null until they write one', async () => {
      const res = makeRes();
      await createAgencyHandlers(makeDeps()).getPrompt(makeReq() as never, res as never);
      expect(res.body).toEqual({ prompt: { template: null }, default: DEFAULT_AGENCY_PROMPT });
    });

    it('offers the configured instructions as the default, and saves them as a reset', async () => {
      const promptTemplate = 'Study coach.';
      const config = { agency: { ...allOn, promptTemplate } };
      const res = makeRes();
      const deps = makeDeps();
      await createAgencyHandlers(deps).getPrompt(makeReq({ config }) as never, res as never);
      expect(res.body).toEqual({ prompt: { template: null }, default: promptTemplate });

      const saved = makeRes();
      await createAgencyHandlers(deps).putPrompt(
        makeReq({ config, body: { template: ` ${promptTemplate} ` } }) as never,
        saved as never,
      );
      expect(saved.body).toEqual({ prompt: { template: null }, masked: false });
      expect(deps.setAgencyPrompt).not.toHaveBeenCalled();
    });

    it('stores a broken template nowhere, and says what is wrong with it', async () => {
      const deps = makeDeps();
      const res = await put(deps, 'Be brief.\n{{#goal}}Aim at {{goal}}');
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        code: 'invalid_template',
        errors: [{ code: 'unclosed_section', tag: '{{#goal}}', line: 2, column: 1 }],
      });
      expect(deps.setAgencyPrompt).not.toHaveBeenCalled();
      expect(deps.addAgencyPromptRevision).not.toHaveBeenCalled();
      expect((await put(deps, 42)).statusCode).toBe(400);
    });

    it('stores only the masked text, in the template and its log, and logs no text', async () => {
      const deps = makeDeps();
      const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
      const res = await put(deps, 'Call me on 07700900123. {{#goal}}{{goal}}{{/goal}}');
      const masked = 'Call me on ###########. {{#goal}}{{goal}}{{/goal}}';
      expect(deps.setAgencyPrompt).toHaveBeenCalledWith('u1', masked);
      expect(deps.addAgencyPromptRevision).toHaveBeenCalledWith('u1', masked);
      expect(deps.record.event).toHaveBeenCalledWith({
        userId: 'u1',
        type: 'prompt_customised',
        detail: 'rev1',
      });
      expect(res.body).toEqual({ prompt: { template: masked, updatedAt: 'a' }, masked: true });
      expect(info).toHaveBeenCalledWith('[agency] Hidden instructions changed', {
        userId: 'u1',
        revisionId: 'rev1',
        length: masked.length,
        masked: true,
      });
      expect(JSON.stringify(info.mock.calls)).not.toContain('Call me');
      info.mockRestore();
    });

    it('saves an empty template as is, without masking or screening it', async () => {
      const deps = makeDeps();
      jest.mocked(maskUserText).mockClear();
      const res = await put(deps, '  ');
      expect(res.statusCode).toBe(200);
      expect(deps.setAgencyPrompt).toHaveBeenCalledWith('u1', '');
      expect(deps.addAgencyPromptRevision).toHaveBeenCalledWith('u1', '');
      expect(maskUserText).not.toHaveBeenCalled();
      expect(res.body).toEqual({ prompt: { template: '', updatedAt: 'a' }, masked: false });
    });

    it('stores nothing when the text cannot be masked', async () => {
      const deps = makeDeps();
      jest.mocked(maskUserText).mockRejectedValueOnce(new Error('guardrail down'));
      const res = await put(deps, 'Be brief.');
      expect(res.statusCode).toBe(503);
      expect(deps.setAgencyPrompt).not.toHaveBeenCalled();
      expect(deps.addAgencyPromptRevision).not.toHaveBeenCalled();
    });

    it('refuses instructions safeguarding blocks', async () => {
      const deps = makeDeps();
      const info = { source: 'instructions', reasons: [{ type: 'topic', name: 'self-harm' }] };
      (screenForSafeguarding as jest.Mock).mockResolvedValueOnce({ ok: false, info });
      const res = makeRes();
      await createAgencyHandlers(deps).putPrompt(
        makeReq({
          config: { agency: allOn, safeguarding: {} },
          body: { template: 'Be brief.' },
        }) as never,
        res as never,
      );
      expect(res.statusCode).toBe(422);
      expect(res.body).toEqual({ type: 'safeguarding', info });
      expect(deps.setAgencyPrompt).not.toHaveBeenCalled();
      expect(screenForSafeguarding).toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.objectContaining({ source: 'instructions' }) }),
      );
    });

    it('treats the default itself, and a reset, as going back to the default, logged as resets', async () => {
      const deps = makeDeps();
      const res = await put(deps, DEFAULT_AGENCY_PROMPT);
      expect(res.body).toEqual({ prompt: { template: null }, masked: false });
      expect(deps.setAgencyPrompt).not.toHaveBeenCalled();

      const reset = makeRes();
      await createAgencyHandlers(deps).deletePrompt(makeReq() as never, reset as never);
      expect(reset.body).toEqual({ prompt: { template: null } });
      expect(deps.deleteAgencyPrompt).toHaveBeenCalledTimes(2);
      expect(deps.addAgencyPromptRevision).toHaveBeenNthCalledWith(2, 'u1', null);
      expect(deps.record.event).toHaveBeenCalledWith({
        userId: 'u1',
        type: 'prompt_reset',
        detail: 'rev1',
      });
    });
  });

  it('passes the range to the recap, refusing an unknown range', async () => {
    const deps = makeDeps();
    const handlers = createAgencyHandlers(deps);
    await handlers.getRecap(
      makeReq({
        query: { range: '30d' },
      }) as never,
      makeRes() as never,
    );
    expect(deps.getAgencyRecap).toHaveBeenCalledWith('u1', { range: '30d' });
    await createAgencyHandlers(deps).getRecap(
      makeReq({
        config: { agency: { ...allOn, classifier: { signals: [{ id: 'reject' }] } } },
      }) as never,
      makeRes() as never,
    );
    expect(deps.getAgencyRecap).toHaveBeenLastCalledWith('u1', {
      range: '7d',
      signalIds: ['reject'],
    });

    const bad = makeRes();
    await handlers.getRecap(makeReq({ query: { range: '1y' } }) as never, bad as never);
    expect(bad.statusCode).toBe(400);
  });
});

describe('agencyStartupConfig', () => {
  it('sends what the classifier labels, not its endpoint, model, prompts or definitions', () => {
    const topics = [{ id: 'maths', label: 'Maths' }];
    expect(
      agencyStartupConfig({
        ...allOn,
        classifier: {
          endpoint: 'bedrock',
          model: 'secret-model',
          topics,
          signals: [{ id: 'reject', label: 'Rejected', definition: 'secret' }],
          prompts: { topics: 'secret-prompt' },
        },
        promptTemplate: 'Study coach.',
      } as never),
    ).toEqual({
      ...allOn,
      classifier: { topics, signals: [{ id: 'reject', label: 'Rejected' }] },
    });
    expect(agencyStartupConfig(allOn as never)).toEqual(allOn);
    expect(
      agencyStartupConfig({
        ...allOn,
        classifier: { endpoint: 'bedrock', model: 'm', topics },
      } as never),
    ).toEqual({ ...allOn, classifier: { topics, signals: [] } });
  });
});
