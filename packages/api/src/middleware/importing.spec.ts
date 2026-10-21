import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { requireConversationImportEnabled } from './importing';

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
  requireConversationImportEnabled(req as ServerRequest, res as unknown as Response, next);
  return { res, next };
}

describe('requireConversationImportEnabled', () => {
  it('rejects the import when the interface disables conversation import', () => {
    const { res, next } = run({
      config: { interfaceConfig: { conversationImport: false } },
    } as Partial<ServerRequest>);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Conversation import is disabled' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the import when the interface enables conversation import', () => {
    const { res, next } = run({
      config: { interfaceConfig: { conversationImport: true } },
    } as Partial<ServerRequest>);

    expect(res.statusCode).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the import when the flag is unconfigured', () => {
    const { next } = run({ config: { interfaceConfig: {} } } as Partial<ServerRequest>);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the import when no app config reached the request', () => {
    const { next } = run({});

    expect(next).toHaveBeenCalledTimes(1);
  });
});
