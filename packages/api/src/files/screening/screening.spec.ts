import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { ErrorTypes, uploadScreeningSchema } from 'librechat-data-provider';
import type { TUploadScreening } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { UploadScreeningServices } from './index';
import type { MalwareVerdict } from './quarantine';
import {
  chunkText,
  screenUpload,
  checkFileContent,
  createGuardDutyScanner,
  createTextractReader,
  createGuardrailDetector,
  createUploadScreeningCheck,
  createUploadScreeningServices,
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

async function pptx(...slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((text, index) => {
    zip.file(
      `ppt/slides/slide${index + 1}.xml`,
      `<p:sld><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sld>`,
    );
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

function fakeServices({
  verdict = 'clean',
  identifiers = [],
  imageText,
}: {
  verdict?: MalwareVerdict;
  identifiers?: string[];
  /** Text the image reader finds; `false` for an unreadable image; unset for no reader. */
  imageText?: string | false;
} = {}) {
  const stored = new Set<string>();
  const services = {
    quarantine: {
      put: jest.fn(async (key: string) => void stored.add(key)),
      remove: jest.fn(async (key: string) => void stored.delete(key)),
    },
    scanner: { verdict: jest.fn(async () => verdict) },
    detector: { detect: jest.fn(async () => [...identifiers]) },
    imageReader:
      imageText === undefined
        ? null
        : {
            read: jest.fn(async () =>
              imageText === false ? { ok: false as const } : { ok: true as const, text: imageText },
            ),
          },
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

describe('chunkText', () => {
  it('keeps each chunk within the byte limit and overlaps neighbours', () => {
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkText(text, 500, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(500);
    }
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i - 1].endsWith(chunks[i].slice(0, 50))).toBe(true);
    }
    expect(chunks[chunks.length - 1].endsWith('word399')).toBe(true);
  });

  it('counts bytes, not characters, for multi-byte text', () => {
    const chunks = chunkText('é'.repeat(1000), 300, 20);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(300);
    }
    expect(chunks.join('').length).toBeGreaterThanOrEqual(1000);
  });

  it('returns short text whole', () => {
    expect(chunkText('hello there')).toEqual(['hello there']);
  });
});

describe('createGuardrailDetector', () => {
  /** An ApplyGuardrail response reporting these PII types. */
  const assessed = (...types: Array<string | [string, boolean]>) => ({
    action: types.length > 0 ? 'GUARDRAIL_INTERVENED' : 'NONE',
    assessments: [
      {
        sensitiveInformationPolicy: {
          piiEntities: types.map((entry) => {
            const [type, detected] = typeof entry === 'string' ? [entry, true] : entry;
            return { type, match: 'withheld', action: 'ANONYMIZED', detected };
          }),
          regexes: [{ name: 'UK_POSTCODE', match: 'N1 9GU', action: 'ANONYMIZED' }],
        },
      },
    ],
  });
  const make = (
    send: jest.Mock,
    entities: Parameters<typeof createGuardrailDetector>[0]['entities'],
  ) =>
    createGuardrailDetector({
      client: { send },
      guardrailIdentifier: 'gr1',
      guardrailVersion: '2',
      entities,
    });

  it('reports the configured types the guardrail finds, as an input', async () => {
    const send = jest.fn().mockResolvedValue(assessed('EMAIL', 'NAME'));
    expect(await make(send, ['EMAIL', 'PHONE']).detect('Write to sam@example.com')).toEqual([
      'EMAIL',
    ]);
    expect(send.mock.calls[0][0].input).toEqual({
      guardrailIdentifier: 'gr1',
      guardrailVersion: '2',
      source: 'INPUT',
      content: [{ text: { text: 'Write to sam@example.com' } }],
    });
  });

  it('never refuses for a type outside `entities`, such as a place name', async () => {
    const send = jest.fn().mockResolvedValue(assessed('ADDRESS'));
    expect(await make(send, ['EMAIL']).detect('A trip to Edinburgh, N1 9GU')).toEqual([]);
  });

  it('ignores entries the guardrail marks as not detected', async () => {
    const send = jest.fn().mockResolvedValue(assessed(['PHONE', false]));
    expect(await make(send, ['PHONE']).detect('Multiply 07700 by 900123')).toEqual([]);
  });

  it('reports each type once, however often it appears', async () => {
    const send = jest.fn().mockResolvedValue(assessed('EMAIL', 'EMAIL'));
    expect(await make(send, ['EMAIL']).detect('two emails')).toEqual(['EMAIL']);
  });

  it('screens long text in chunks a request takes, stopping at the first match', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce(assessed())
      .mockResolvedValueOnce(assessed('PASSWORD'));
    expect(await make(send, ['PASSWORD']).detect('x '.repeat(150_000))).toEqual(['PASSWORD']);
    expect(send).toHaveBeenCalledTimes(2);
    for (const [command] of send.mock.calls) {
      expect(command.input.content[0].text.text.length).toBeLessThanOrEqual(100_000);
    }
  });

  it('finds nothing in text the guardrail leaves alone', async () => {
    const send = jest.fn().mockResolvedValue(assessed());
    expect(await make(send, ['EMAIL']).detect('Bake at 180C for 25 minutes.')).toEqual([]);
  });

  it('throws when the guardrail cannot be reached', async () => {
    const send = jest.fn().mockRejectedValue(new Error('AccessDeniedException'));
    await expect(make(send, ['EMAIL']).detect('text')).rejects.toThrow('AccessDeniedException');
  });
});

describe('createTextractReader', () => {
  const lines = (...text: string[]) => ({
    Blocks: [
      { BlockType: 'PAGE' },
      ...text.flatMap((Text) => [
        { BlockType: 'LINE', Text },
        { BlockType: 'WORD', Text },
      ]),
    ],
  });
  /** An image of `pages` frames, each a different shade so encoders keep them all. */
  const image = async (name: string, format: 'png' | 'gif' | 'webp', pages = 1) => {
    const frames = await Promise.all(
      Array.from({ length: pages }, (_, index) =>
        sharp({
          create: { width: 40, height: 20, channels: 3, background: { r: index * 20, g: 0, b: 0 } },
        })
          .png()
          .toBuffer(),
      ),
    );
    const input = pages === 1 ? sharp(frames[0]) : sharp(frames, { join: { animated: true } });
    return upload(name, await input.toFormat(format).toBuffer());
  };
  const thrown = (name: string) => Object.assign(new Error(name), { name });

  it('sends each image to Textract as PNG bytes and joins the lines it reads', async () => {
    const send = jest.fn().mockResolvedValue(lines('Sam Jones', 'AB 12 34 56 C'));
    const file = await image('photo.webp', 'webp');
    expect(await createTextractReader({ client: { send } }).read(file.path)).toEqual({
      ok: true,
      text: 'Sam Jones\nAB 12 34 56 C',
    });
    const bytes: Buffer = send.mock.calls[0][0].input.Document.Bytes;
    expect((await sharp(bytes).metadata()).format).toBe('png');
  });

  it('reads every frame of an animated image', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce(lines('first'))
      .mockResolvedValueOnce(lines('second'));
    const file = await image('anim.gif', 'gif', 2);
    expect(await createTextractReader({ client: { send } }).read(file.path)).toEqual({
      ok: true,
      text: 'first\nsecond',
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('cannot read an image with more frames than it reads', async () => {
    const send = jest.fn();
    const file = await image('long.gif', 'gif', 11);
    expect(await createTextractReader({ client: { send } }).read(file.path)).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('cannot read an image sharp cannot decode', async () => {
    const send = jest.fn();
    const file = await upload('photo.png', Buffer.from('this is not an image'));
    expect(await createTextractReader({ client: { send } }).read(file.path)).toEqual({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('cannot read an image Textract rejects', async () => {
    const send = jest.fn().mockRejectedValue(thrown('UnsupportedDocumentException'));
    const file = await image('photo.png', 'png');
    expect(await createTextractReader({ client: { send } }).read(file.path)).toEqual({ ok: false });
  });

  it('throws when Textract itself fails', async () => {
    const send = jest.fn().mockRejectedValue(thrown('ProvisionedThroughputExceededException'));
    const file = await image('photo.png', 'png');
    await expect(createTextractReader({ client: { send } }).read(file.path)).rejects.toThrow(
      'ProvisionedThroughputExceededException',
    );
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

  it('accepts a clean text file and removes the quarantined copy', async () => {
    const { services, stored } = fakeServices();
    const file = await upload('notes.txt', 'Nothing personal in here.');
    expect(await screen(file, services)).toEqual({ ok: true });
    expect(services.quarantine.put).toHaveBeenCalledWith('user-1/file-1', file);
    expect(services.detector.detect).toHaveBeenCalledWith('Nothing personal in here.');
    expect(stored.size).toBe(0);
  });

  it('refuses a file the malware scan flags, without reading its text', async () => {
    const { services, stored } = fakeServices({ verdict: 'infected' });
    const file = await upload('notes.txt', 'X5O!P%@AP');
    expect(await screen(file, services)).toEqual({
      ok: false,
      error: { code: ErrorTypes.UPLOAD_REJECTED, reason: 'malware' },
    });
    expect(services.detector.detect).not.toHaveBeenCalled();
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

  it('screens the text an image reader finds in an image', async () => {
    const { services } = fakeServices({
      imageText: 'NI number AB 12 34 56 C',
      identifiers: ['UK_NATIONAL_INSURANCE_NUMBER'],
    });
    const file = await upload('photo.png', PNG);
    expect(await screen(file, services)).toMatchObject({
      ok: false,
      error: { reason: 'identifiers', identifiers: ['UK_NATIONAL_INSURANCE_NUMBER'] },
    });
    expect(services.imageReader?.read).toHaveBeenCalledWith(file.path);
    expect(services.detector.detect).toHaveBeenCalledWith('NI number AB 12 34 56 C');
  });

  it('accepts an image with no text without calling the detector', async () => {
    const { services } = fakeServices({ imageText: '' });
    const file = await upload('photo.png', PNG);
    expect(await screen(file, services)).toEqual({ ok: true });
    expect(services.detector.detect).not.toHaveBeenCalled();
  });

  it('refuses an image its reader cannot read', async () => {
    const { services, stored } = fakeServices({ imageText: false });
    const file = await upload('photo.png', PNG);
    expect(await screen(file, services)).toMatchObject({
      ok: false,
      error: { reason: 'unreadable' },
    });
    expect(stored.size).toBe(0);
  });

  it('checks images for type and malware only without an image reader', async () => {
    const { services } = fakeServices();
    const file = await upload('photo.png', PNG);
    expect(await screen(file, services)).toEqual({ ok: true });
    expect(services.scanner.verdict).toHaveBeenCalled();
    expect(services.detector.detect).not.toHaveBeenCalled();
  });

  it('refuses text the detector finds identifiers in, naming only their types', async () => {
    const { services } = fakeServices({ identifiers: ['EMAIL'] });
    const file = await upload('notes.md', 'Contact me');
    expect(await screen(file, services)).toEqual({
      ok: false,
      error: { code: ErrorTypes.UPLOAD_REJECTED, reason: 'identifiers', identifiers: ['EMAIL'] },
    });
  });

  it('screens the text of every slide in a presentation', async () => {
    const { services } = fakeServices({ identifiers: ['EMAIL'] });
    const file = await upload(
      'deck.pptx',
      await pptx('Welcome', 'Write to sam.jones@example.com'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(await screen(file, services)).toMatchObject({
      ok: false,
      error: { identifiers: ['EMAIL'] },
    });
    expect(services.detector.detect).toHaveBeenCalledWith(
      expect.stringMatching(/Welcome[\s\S]*sam\.jones@example\.com/),
    );
  });

  it('refuses a document that cannot be parsed', async () => {
    const { services, stored } = fakeServices();
    const file = await upload(
      'broken.docx',
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not a real zip')]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(await screen(file, services)).toMatchObject({
      ok: false,
      error: { reason: 'unreadable' },
    });
    expect(stored.size).toBe(0);
  });

  it('refuses a "text" file that is really binary', async () => {
    const { services } = fakeServices();
    const file = await upload('notes.txt', Buffer.from([0x00, 0x01, 0x02, 0xff]));
    expect(await screen(file, services)).toMatchObject({
      ok: false,
      error: { reason: 'unreadable' },
    });
  });

  it('refuses text longer than it may screen', async () => {
    const { services } = fakeServices();
    const file = await upload('long.txt', 'a'.repeat(101));
    const result = await screenUpload({
      file,
      key: 'k',
      config: { ...config, pii: { ...config.pii, maxCharacters: 100 } },
      services,
    });
    expect(result).toMatchObject({ ok: false, error: { reason: 'too_long' } });
    expect(services.detector.detect).not.toHaveBeenCalled();
  });

  it('accepts a file with no text without calling the detector', async () => {
    const { services } = fakeServices();
    const file = await upload('blank.txt', '   \n');
    expect(await screen(file, services)).toEqual({ ok: true });
    expect(services.detector.detect).not.toHaveBeenCalled();
  });

  it('removes the quarantined copy when a service fails', async () => {
    const { services, stored } = fakeServices();
    services.detector.detect.mockRejectedValueOnce(new Error('throttled'));
    const file = await upload('notes.txt', 'text');
    await expect(screen(file, services)).rejects.toThrow('throttled');
    expect(stored.size).toBe(0);
  });
});

describe('createUploadScreeningServices', () => {
  const env = {
    AWS_QUARANTINE_BUCKET_NAME: 'quarantine',
    AWS_REGION: 'eu-west-2',
  } as NodeJS.ProcessEnv;
  const saved = {
    AWS_REGION: process.env.AWS_REGION,
    AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,
  };
  beforeAll(() => {
    Object.assign(process.env, { AWS_REGION: 'eu-west-2', AWS_BUCKET_NAME: 'uploads' });
  });
  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('refuses to build a guardrail detector without a guardrail to screen with', () => {
    expect(() => createUploadScreeningServices(config, undefined, env)).toThrow(
      'neither uploadScreening.pii.guardrail nor piiMasking.guardrail',
    );
  });

  it('screens with the upload guardrail before the masking one', async () => {
    const own = uploadScreeningSchema.parse({
      pii: { guardrail: { guardrailIdentifier: 'uploads', guardrailVersion: '1' } },
    });
    const services = createUploadScreeningServices(
      own,
      { guardrailIdentifier: 'chat', guardrailVersion: '1' },
      env,
    );
    const send = jest.spyOn(BedrockRuntimeClient.prototype, 'send').mockResolvedValue({
      assessments: [],
    } as never);
    await services.detector.detect('Some text');
    expect((send.mock.calls[0][0] as { input: object }).input).toMatchObject({
      guardrailIdentifier: 'uploads',
    });
    send.mockRestore();
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

  it('passes a clean upload on, quarantined under the user and file id', async () => {
    const { services } = fakeServices();
    const { next, kept } = await run(services);
    expect(next).toHaveBeenCalledWith();
    expect(kept).toBe(true);
    expect(services.quarantine.put.mock.calls[0][0]).toBe('user-1/file-1');
  });

  it('answers a refusal with 422, the reason and its translation key, and deletes the file', async () => {
    const { services } = fakeServices({ identifiers: ['UK_NATIONAL_INSURANCE_NUMBER'] });
    const { next, res, kept } = await run(services);
    expect(next).not.toHaveBeenCalled();
    expect(kept).toBe(false);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      message: 'com_error_files_identifiers',
      code: ErrorTypes.UPLOAD_REJECTED,
      reason: 'identifiers',
      identifiers: ['UK_NATIONAL_INSURANCE_NUMBER'],
    });
  });

  it('builds services with the masking guardrail as the fallback for screening', async () => {
    const { services } = fakeServices();
    const guardrail = { guardrailIdentifier: 'gr1', guardrailVersion: '3' };
    const createServices = jest.fn(() => services);
    const file = await upload('notes.txt', 'Hello');
    const req = {
      user: { id: 'user-1' },
      file_id: 'file-1',
      file,
      config: { uploadScreening: config, piiMasking: { guardrail } },
    } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    await createUploadScreeningCheck({ createServices })(req, res, jest.fn());
    expect(createServices).toHaveBeenCalledWith(config, guardrail);
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
