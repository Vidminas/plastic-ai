import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';
import { FileSources } from 'librechat-data-provider';
import type { CookieAuthResult } from '~/images/authorization';
import type { S3Object } from '../proxy';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/key?signed=true'),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const owner = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const key = `images/${owner}/file-1__photo one.png`;

type Modules = {
  crud: typeof import('../crud');
  link: typeof import('../link');
  messages: typeof import('../messages');
  proxy: typeof import('../proxy');
};

/** s3Config reads the environment once, when the module loads. */
function loadModules(env: Record<string, string>): Modules {
  let modules: Modules | undefined;
  jest.isolateModules(() => {
    Object.assign(process.env, env);
    modules = {
      crud: jest.requireActual('../crud'),
      link: jest.requireActual('../link'),
      messages: jest.requireActual('../messages'),
      proxy: jest.requireActual('../proxy'),
    };
  });
  return modules!;
}

const expiredSignedUrl = () => {
  const signedAt = new Date(Date.now() - 60 * 1000);
  const date = signedAt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=abc&X-Amz-Date=${date}&X-Amz-Expires=604800`;
};

describe('S3 file links through the app', () => {
  const originalEnv = { ...process.env };
  let modules: Modules;

  beforeAll(() => {
    modules = loadModules({
      AWS_REGION: 'eu-west-2',
      AWS_BUCKET_NAME: 'test-bucket',
      S3_PROXY_FILES: 'true',
      DOMAIN_CLIENT: 'https://chat.example.com',
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('links', () => {
    it('round-trips a key through an encoded link', () => {
      const { getS3ProxyURL, getKeyFromS3ProxyURL } = modules.link;
      const url = getS3ProxyURL(key);
      expect(url).toBe(`/api/s3-files/images/${owner}/file-1__photo%20one.png`);
      expect(getKeyFromS3ProxyURL(url)).toBe(key);
      expect(getKeyFromS3ProxyURL(getS3ProxyURL(key, 'photo.png'))).toBe(key);
      expect(getKeyFromS3ProxyURL('https://bucket.s3.amazonaws.com/x')).toBeNull();
    });

    it('prefixes the base path of a subdirectory deployment', () => {
      process.env.DOMAIN_CLIENT = 'https://example.com/chat/';
      try {
        const url = modules.link.getS3ProxyURL(key);
        expect(url.startsWith('/chat/api/s3-files/images/')).toBe(true);
        expect(modules.link.getKeyFromS3ProxyURL(url)).toBe(key);
      } finally {
        process.env.DOMAIN_CLIENT = 'https://chat.example.com';
      }
    });

    it('makes stored links the app route instead of presigned URLs', async () => {
      const { getS3URL, extractKeyFromS3Url, needsRefresh, refreshS3Url } = modules.crud;
      const url = await getS3URL({ userId: owner, fileName: 'file-1__photo one.png' });
      expect(url).toBe(modules.link.getS3ProxyURL(key));
      expect(extractKeyFromS3Url(url)).toBe(key);
      expect(needsRefresh(url, 3600)).toBe(false);
      expect(needsRefresh(expiredSignedUrl(), 0)).toBe(true);
      await expect(
        refreshS3Url({ source: FileSources.s3, filepath: expiredSignedUrl() }),
      ).resolves.toBe(url);
    });

    it('replaces presigned links saved in messages', async () => {
      const messages = [{ files: [{ source: FileSources.s3, filepath: expiredSignedUrl() }] }];
      await modules.messages.refreshMessageFileUrls(messages);
      expect(messages[0].files[0].filepath).toBe(modules.link.getS3ProxyURL(key));
    });
  });

  describe('route', () => {
    let auth: CookieAuthResult;
    let getObject: jest.Mock<Promise<S3Object>, [string, { head: boolean; signal: AbortSignal }]>;

    const app = () => {
      const server = express();
      server.use(
        modules.link.S3_PROXY_ROUTE,
        modules.proxy.createS3ProxyHandler({ authenticate: async () => auth, getObject }),
      );
      return server;
    };
    const path = () => modules.link.getS3ProxyURL(key);

    beforeEach(() => {
      auth = { status: 'authenticated', userId: owner };
      getObject = jest.fn(async (_key, { head }) => ({
        contentLength: 5,
        body: head ? undefined : Readable.from([Buffer.from('image')]),
      }));
    });

    it('serves an image inline to its owner', async () => {
      const res = await request(app()).get(path());
      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe('image');
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toBe('inline');
      expect(res.headers['content-security-policy']).toContain('sandbox');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, max-age=3600');
      expect(getObject).toHaveBeenCalledWith(key, expect.objectContaining({ head: false }));
    });

    it('answers HEAD with the size and no body', async () => {
      const res = await request(app()).head(path());
      expect(res.status).toBe(200);
      expect(res.headers['content-length']).toBe('5');
      expect(getObject).toHaveBeenCalledWith(key, expect.objectContaining({ head: true }));
    });

    it('sends documents and requested downloads as attachments', async () => {
      const documentKey = `uploads/${owner}/file-2__notes.html`;
      const document = await request(app()).get(modules.link.getS3ProxyURL(documentKey));
      expect(document.headers['content-type']).toBe('application/octet-stream');
      expect(document.headers['content-disposition']).toBe(
        'attachment; filename="file-2__notes.html"',
      );

      const download = await request(app()).get(modules.link.getS3ProxyURL(key, 'my "photo".png'));
      expect(download.headers['content-disposition']).toBe('attachment; filename="my photo.png"');
    });

    it('refuses requests without a valid session', async () => {
      auth = { status: 'missing' };
      expect((await request(app()).get(path())).status).toBe(401);
      auth = { status: 'invalid' };
      expect((await request(app()).get(path())).status).toBe(403);
      expect(getObject).not.toHaveBeenCalled();
    });

    it("hides other users' files", async () => {
      auth = { status: 'authenticated', userId: 'ffffffffffffffffffffffff' };
      const res = await request(app()).get(path());
      expect(res.status).toBe(404);
      expect(getObject).not.toHaveBeenCalled();
    });

    it('rejects keys that do not name an owner', async () => {
      const res = await request(app()).get(`${modules.link.S3_PROXY_ROUTE}/${owner}`);
      expect(res.status).toBe(404);
    });

    it('maps a missing object to 404 and other failures to a bare 500', async () => {
      getObject.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }));
      expect((await request(app()).get(path())).status).toBe(404);

      getObject.mockRejectedValueOnce(new Error('secret detail'));
      const res = await request(app()).get(path());
      expect(res.status).toBe(500);
      expect(res.text).not.toContain('secret');
    });

    it('allows only reads', async () => {
      expect((await request(app()).delete(path())).status).toBe(405);
    });
  });
});
