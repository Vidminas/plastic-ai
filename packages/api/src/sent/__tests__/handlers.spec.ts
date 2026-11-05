import { createSentPromptHandler } from '../handlers';

const sentPrompt = { system: 'S', message: 'M', historyCount: 0, tools: [], truncated: false };

const makeRes = () => {
  const res = { statusCode: 200, body: undefined as unknown } as {
    statusCode: number;
    body: unknown;
    status: jest.Mock;
    json: jest.Mock;
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
};

const makeReq = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'u1' },
  config: { interfaceConfig: { sentPrompt: true } },
  params: { conversationId: 'c1', messageId: 'm1' },
  ...overrides,
});

describe('createSentPromptHandler', () => {
  it("sends what the user's own message sent", async () => {
    const getSentPrompt = jest.fn().mockResolvedValue(sentPrompt);
    const res = makeRes();
    await createSentPromptHandler({ getSentPrompt })(makeReq() as never, res as never);
    expect(getSentPrompt).toHaveBeenCalledWith('u1', 'c1', 'm1');
    expect(res.body).toEqual({ sentPrompt });
  });

  it('answers 404 while the feature is off, and when nothing was kept', async () => {
    const getSentPrompt = jest.fn().mockResolvedValue(null);
    const handler = createSentPromptHandler({ getSentPrompt });
    const off = makeRes();
    await handler(makeReq({ config: { interfaceConfig: {} } }) as never, off as never);
    expect(off.statusCode).toBe(404);
    expect(getSentPrompt).not.toHaveBeenCalled();

    const missing = makeRes();
    await handler(makeReq() as never, missing as never);
    expect(missing.statusCode).toBe(404);
  });

  it('answers 401 without a user and 500 without the error text when the read fails', async () => {
    const getSentPrompt = jest.fn().mockRejectedValue(new Error('secret detail'));
    const handler = createSentPromptHandler({ getSentPrompt });
    const anonymous = makeRes();
    await handler(makeReq({ user: undefined }) as never, anonymous as never);
    expect(anonymous.statusCode).toBe(401);

    const failed = makeRes();
    await handler(makeReq() as never, failed as never);
    expect(failed.statusCode).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain('secret');
  });
});
