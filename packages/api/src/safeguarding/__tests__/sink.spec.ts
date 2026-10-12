import { createOtlpSafeguardingSink, toOtlpSpan } from '../sink';

const record = {
  severity: 'flag' as const,
  source: 'response',
  userId: 'u1',
  studyId: 'sub-1',
  conversationId: 'c1',
  filters: 'content:INSULTS:MEDIUM',
};

describe('toOtlpSpan', () => {
  it('makes one safeguarding span carrying the record as attributes', () => {
    const body = toOtlpSpan(record, {
      serviceName: 'plastic-ai-web-api',
      at: new Date('2026-10-12T10:00:00.000Z'),
    });
    const [resource] = body.resourceSpans;
    const [span] = resource.scopeSpans[0].spans;
    expect(resource.resource.attributes).toEqual([
      { key: 'service.name', value: { stringValue: 'plastic-ai-web-api' } },
    ]);
    expect(span).toMatchObject({
      name: 'safeguarding.flag',
      startTimeUnixNano: '1791799200000000000',
      endTimeUnixNano: '1791799200000000000',
    });
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.attributes).toContainEqual({ key: 'userId', value: { stringValue: 'u1' } });
    expect(span.attributes).toContainEqual({
      key: 'filters',
      value: { stringValue: 'content:INSULTS:MEDIUM' },
    });
  });
});

describe('createOtlpSafeguardingSink', () => {
  it('posts the span to the collector with its authorization', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    await createOtlpSafeguardingSink({
      target: 'http://collector:4318/v1/traces',
      authorization: 'token',
      serviceName: 'svc',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).write(record);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://collector:4318/v1/traces');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'token' },
      redirect: 'error',
    });
    expect(JSON.parse(init.body).resourceSpans[0].scopeSpans[0].spans[0].name).toBe(
      'safeguarding.flag',
    );
  });

  it('throws when the collector refuses the record', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(
      createOtlpSafeguardingSink({
        target: 'http://collector:4318/v1/traces',
        serviceName: 'svc',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }).write(record),
    ).rejects.toThrow('401');
  });
});
