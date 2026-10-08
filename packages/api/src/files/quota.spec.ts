import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { ErrorTypes } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import { createStorageQuotaCheck } from './quota';

const MB = 1024 * 1024;

async function run({
  usedBytes,
  fileBytes,
  userStorageLimit,
}: {
  usedBytes: number;
  fileBytes: number;
  userStorageLimit?: number;
}) {
  const filePath = path.join(os.tmpdir(), `quota-spec-${Date.now()}-${Math.random()}`);
  await fs.writeFile(filePath, 'upload');
  const getUserStorageBytes = jest.fn().mockResolvedValue(usedBytes);
  const req = {
    user: { id: 'user-1' },
    file: { path: filePath, size: fileBytes },
    config: { fileConfig: userStorageLimit == null ? {} : { userStorageLimit } },
  } as unknown as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn() as NextFunction;
  await createStorageQuotaCheck({ getUserStorageBytes })(req, res, next);
  const kept = await fs.stat(filePath).then(
    () => true,
    () => false,
  );
  await fs.rm(filePath, { force: true });
  return { res, next, kept, getUserStorageBytes };
}

describe('createStorageQuotaCheck', () => {
  it('lets an upload through when it fits in the remaining storage', async () => {
    const { next, res, kept } = await run({
      usedBytes: 1900 * MB,
      fileBytes: 100 * MB,
      userStorageLimit: 2048,
    });
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(kept).toBe(true);
  });

  it('refuses an upload past the limit and removes the uploaded file', async () => {
    const { next, res, kept } = await run({
      usedBytes: 2000 * MB,
      fileBytes: 100 * MB,
      userStorageLimit: 2048,
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      message: 'com_error_files_storage_limit',
      code: ErrorTypes.STORAGE_QUOTA_EXCEEDED,
      usedBytes: 2000 * MB,
      limitBytes: 2048 * MB,
    });
    expect(kept).toBe(false);
  });

  it('skips the lookup without a configured limit', async () => {
    const { next, getUserStorageBytes } = await run({ usedBytes: 0, fileBytes: 1 });
    expect(next).toHaveBeenCalledWith();
    expect(getUserStorageBytes).not.toHaveBeenCalled();
  });
});
