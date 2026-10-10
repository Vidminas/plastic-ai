import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { ErrorTypes, uploadScreeningSchema } from 'librechat-data-provider';
import type { TUploadScreening } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { UploadScreeningServices } from './index';
import type { MalwareVerdict } from './quarantine';
import {
  screenUpload,
  checkFileContent,
  createGuardDutyScanner,
  createUploadScreeningCheck,
} from './index';

const config: TUploadScreening = uploadScreeningSchema.parse({});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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

function fakeServices({ verdict = 'clean' }: { verdict?: MalwareVerdict } = {}) {
  const stored = new Set<string>();
  const services = {
    quarantine: {
      put: jest.fn(async (key: string) => void stored.add(key)),
      remove: jest.fn(async (key: string) => void stored.delete(key)),
    },
    scanner: { verdict: jest.fn(async () => verdict) },
  } satisfies UploadScreeningServices;
  return { services, stored };
}

describe('checkFileContent', () => {
  it('accepts bytes that match the extension', async () => {
    const pdf = await upload('report.pdf', '%PDF-1.7\n');
    const image = await upload('photo.PNG', PNG);
    expect(await checkFileContent(pdf.path, pdf.originalname)).toEqual({
      ok: true,
      kind: 'document',
    });
    expect(await checkFileContent(image.path, image.originalname)).toEqual({
      ok: true,
      kind: 'image',
    });
  });

  it('refuses a file renamed to look like another type', async () => {
    const renamed = await upload('invoice.pdf', Buffer.from('MZ\x90\x00 executable'));
    expect(await checkFileContent(renamed.path, renamed.originalname)).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
  });

  it('refuses an extension it cannot screen', async () => {
    const archive = await upload('bundle.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const bare = await upload('README', 'text');
    expect(await checkFileContent(archive.path, archive.originalname)).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
    expect(await checkFileContent(bare.path, bare.originalname)).toEqual({
      ok: false,
      reason: 'unsupported_type',
    });
  });
});

describe('createGuardDutyScanner', () => {
  const tagged = (status?: string) => ({
    TagSet: status ? [{ Key: 'GuardDutyMalwareScanStatus', Value: status }] : [],
  });

  it.each([
    ['NO_THREATS_FOUND', 'clean'],
    ['THREATS_FOUND', 'infected'],
    ['UNSUPPORTED', 'unscannable'],
    ['FAILED', 'unscannable'],
  ])('maps %s to %s once the tag appears', async (status, verdict) => {
    const send = jest.fn().mockResolvedValueOnce(tagged()).mockResolvedValueOnce(tagged(status));
    const wait = jest.fn(async () => undefined);
    const scanner = createGuardDutyScanner({ client: { send }, bucket: 'quarantine', wait });
    expect(await scanner.verdict('user/file', 10_000)).toBe(verdict);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('times out when no verdict arrives', async () => {
    let clock = 0;
    const send = jest.fn().mockResolvedValue(tagged());
    const scanner = createGuardDutyScanner({
      client: { send },
      bucket: 'quarantine',
      now: () => clock,
      wait: async (ms) => {
        clock += ms;
      },
    });
    expect(await scanner.verdict('user/file', 3_000)).toBe('timeout');
  });
});

describe('screenUpload', () => {
  const screen = (file: Express.Multer.File, services: UploadScreeningServices) =>
    screenUpload({ file, key: 'user-1/file-1', config, services });

  it('accepts a clean file and removes the quarantined copy', async () => {
    const { services, stored } = fakeServices();
    const file = await upload('notes.txt', 'Nothing personal in here.');
    expect(await screen(file, services)).toEqual({ ok: true });
    expect(services.quarantine.put).toHaveBeenCalledWith('user-1/file-1', file);
    expect(services.scanner.verdict).toHaveBeenCalledWith('user-1/file-1', 60_000);
    expect(stored.size).toBe(0);
  });

  it('refuses a file the malware scan flags', async () => {
    const { services, stored } = fakeServices({ verdict: 'infected' });
    const file = await upload('notes.txt', 'X5O!P%@AP');
    expect(await screen(file, services)).toEqual({
      ok: false,
      error: { code: ErrorTypes.UPLOAD_REJECTED, reason: 'malware' },
    });
    expect(stored.size).toBe(0);
  });

  it.each<MalwareVerdict>(['timeout', 'unscannable'])(
    'refuses a file whose scan ends %s',
    async (verdict) => {
      const { services } = fakeServices({ verdict });
      const file = await upload('notes.txt', 'text');
      expect(await screen(file, services)).toMatchObject({
        ok: false,
        error: { reason: 'scan_unavailable' },
      });
    },
  );

  it('refuses a mismatched file before it reaches quarantine', async () => {
    const { services } = fakeServices();
    const file = await upload('photo.png', '%PDF-1.7');
    expect(await screen(file, services)).toMatchObject({
      ok: false,
      error: { reason: 'type_mismatch' },
    });
    expect(services.quarantine.put).not.toHaveBeenCalled();
  });

  it('scans images too', async () => {
    const { services } = fakeServices();
    const file = await upload('photo.png', PNG);
    expect(await screen(file, services)).toEqual({ ok: true });
    expect(services.scanner.verdict).toHaveBeenCalled();
  });

  it('removes the quarantined copy when the scan fails', async () => {
    const { services, stored } = fakeServices();
    services.scanner.verdict.mockRejectedValueOnce(new Error('throttled'));
    const file = await upload('notes.txt', 'text');
    await expect(screen(file, services)).rejects.toThrow('throttled');
    expect(stored.size).toBe(0);
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

  it('answers a refusal with 422, the reason and its translation key, and deletes the file', async () => {
    const { services } = fakeServices({ verdict: 'infected' });
    const { next, res, kept } = await run(services);
    expect(next).not.toHaveBeenCalled();
    expect(kept).toBe(false);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      message: 'com_error_files_malware',
      code: ErrorTypes.UPLOAD_REJECTED,
      reason: 'malware',
    });
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
