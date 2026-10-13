import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { requireForkingEnabled } from './forking';

function createResponse() {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function run(req: Partial<ServerRequest>) {
  const res = createResponse();
  const next = jest.fn() as unknown as NextFunction;
  requireForkingEnabled(req as ServerRequest, res as unknown as Response, next);
  return { res, next };
}

describe('requireForkingEnabled', () => {
  it('rejects the fork when the interface disables forking', () => {
    const { res, next } = run({
      config: { interfaceConfig: { forking: false } },
    } as Partial<ServerRequest>);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forking is disabled' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the fork when the interface enables forking', () => {
    const { res, next } = run({
      config: { interfaceConfig: { forking: true } },
    } as Partial<ServerRequest>);

    expect(res.statusCode).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the fork when the flag is unconfigured', () => {
    const { next } = run({ config: { interfaceConfig: {} } } as Partial<ServerRequest>);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the fork when no app config reached the request', () => {
    const { next } = run({});

    expect(next).toHaveBeenCalledTimes(1);
  });
});
