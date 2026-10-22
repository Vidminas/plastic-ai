import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { requireAvatarUploadEnabled } from './avatar';

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
  requireAvatarUploadEnabled(req as ServerRequest, res as unknown as Response, next);
  return { res, next };
}

describe('requireAvatarUploadEnabled', () => {
  it('rejects the upload when the interface disables profile pictures', () => {
    const { res, next } = run({
      config: { interfaceConfig: { avatarUpload: false } },
    } as Partial<ServerRequest>);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Profile picture uploads are disabled' });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows the upload when the interface enables profile pictures', () => {
    const { res, next } = run({
      config: { interfaceConfig: { avatarUpload: true } },
    } as Partial<ServerRequest>);

    expect(res.statusCode).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the upload when the flag is unconfigured', () => {
    const { next } = run({ config: { interfaceConfig: {} } } as Partial<ServerRequest>);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the upload when no app config reached the request', () => {
    const { next } = run({});

    expect(next).toHaveBeenCalledTimes(1);
  });
});
