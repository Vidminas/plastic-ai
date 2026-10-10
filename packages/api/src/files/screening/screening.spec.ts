import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { uploadScreeningSchema } from 'librechat-data-provider';
import type { TUploadScreening } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { UploadScreeningServices } from './index';
import { screenUpload, createUploadScreeningCheck } from './index';

const config: TUploadScreening = uploadScreeningSchema.parse({});

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'screening-spec-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function upload(
  originalname: string,
  content: Buffer | string,
  mimetype = 'application/octet-stream',
): Promise<Express.Multer.File> {
  const filePath = path.join(dir, `${Math.random()}`);
  await fs.writeFile(filePath, content);
  const { size } = await fs.stat(filePath);
  return { path: filePath, originalname, mimetype, size } as Express.Multer.File;
}

function fakeServices() {
  const stored = new Set<string>();
  const services = {
    quarantine: {
      put: jest.fn(async (key: string) => void stored.add(key)),
      remove: jest.fn(async (key: string) => void stored.delete(key)),
    },
  } satisfies UploadScreeningServices;
  return { services, stored };
}

describe('screenUpload', () => {
  it('holds an upload in quarantine, then removes the quarantined copy', async () => {
    const { services, stored } = fakeServices();
    const file = await upload('notes.txt', 'Nothing personal in here.');
    expect(await screenUpload({ file, key: 'user-1/file-1', config, services })).toEqual({
      ok: true,
    });
    expect(services.quarantine.put).toHaveBeenCalledWith('user-1/file-1', file);
    expect(services.quarantine.remove).toHaveBeenCalledWith('user-1/file-1');
    expect(stored.size).toBe(0);
  });

  it('throws when the quarantine cannot take the upload', async () => {
    const { services } = fakeServices();
    services.quarantine.put.mockRejectedValueOnce(new Error('S3 unavailable'));
    const file = await upload('notes.txt', 'text');
    await expect(screenUpload({ file, key: 'k', config, services })).rejects.toThrow(
      'S3 unavailable',
    );
    expect(services.quarantine.remove).not.toHaveBeenCalled();
  });
});

describe('createUploadScreeningCheck', () => {
  async function run(
    services: UploadScreeningServices,
    uploadScreening: TUploadScreening | null = config,
  ) {
    const file = await upload('notes.txt', 'Hello');
    const req = {
      user: { id: 'user-1' },
      file_id: 'file-1',
      file,
      config: { uploadScreening: uploadScreening ?? undefined },
    } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn() as NextFunction;
    await createUploadScreeningCheck({ createServices: () => services })(req, res, next);
    const kept = await fs.stat(file.path).then(
      () => true,
      () => false,
    );
    return { res, next, kept };
  }

  it('passes uploads through when screening is not configured', async () => {
    const { services } = fakeServices();
    const { next, res } = await run(services, null);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(services.quarantine.put).not.toHaveBeenCalled();
  });

  it('passes an upload on, quarantined under the user and file id', async () => {
    const { services } = fakeServices();
    const { next, kept } = await run(services);
    expect(next).toHaveBeenCalledWith();
    expect(kept).toBe(true);
    expect(services.quarantine.put.mock.calls[0][0]).toBe('user-1/file-1');
  });

  it('answers 503 when a screening service is down', async () => {
    const { services } = fakeServices();
    services.quarantine.put.mockRejectedValueOnce(new Error('S3 unavailable'));
    const { res, next, kept } = await run(services);
    expect(next).not.toHaveBeenCalled();
    expect(kept).toBe(false);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'scan_unavailable',
        message: 'com_error_files_scan_unavailable',
      }),
    );
  });
});
