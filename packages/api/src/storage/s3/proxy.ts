import { pipeline } from 'stream/promises';
import { logger } from '@librechat/data-schemas';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { Request, Response } from 'express';
import type { Readable } from 'stream';
import type { CookieAuthResult } from '~/images/authorization';
import { sanitizeContentDispositionFilename } from '~/storage/validation';
import { getSafeErrorMetadata } from '~/utils/errors';
import { initializeS3 } from '~/cdn/s3';
import { s3Config } from './s3Config';
import { parseS3Key } from './crud';

export interface S3Object {
  body?: Readable;
  contentLength?: number;
}

export interface S3ProxyDeps {
  /** Identifies the signed-in user from the request's session cookie. */
  authenticate: (req: Request) => Promise<CookieAuthResult>;
  /** Reads an object, or only its metadata when `head` is set. */
  getObject?: (key: string, options: { head: boolean; signal: AbortSignal }) => Promise<S3Object>;
}

/** Raster images a browser displays; every other file is sent as a download. */
const INLINE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

/**
 * The files are user uploads served from the app's own origin, so a document
 * opened directly (an SVG or HTML file, say) must not run script there.
 */
const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export async function getS3Object(
  key: string,
  { head, signal }: { head: boolean; signal: AbortSignal },
): Promise<S3Object> {
  const s3 = initializeS3();
  if (!s3) {
    throw new Error('[getS3Object] S3 not initialized');
  }
  const params = { Bucket: s3Config.AWS_BUCKET_NAME, Key: key };
  if (head) {
    const data = await s3.send(new HeadObjectCommand(params), { abortSignal: signal });
    return { contentLength: data.ContentLength };
  }
  const data = await s3.send(new GetObjectCommand(params), { abortSignal: signal });
  return { body: data.Body as Readable | undefined, contentLength: data.ContentLength };
}

function decodeKey(path: string): string | null {
  const encoded = path.replace(/^\/+/, '');
  if (!encoded) {
    return null;
  }
  try {
    return encoded.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

function isNotFound(error: unknown): boolean {
  const { name, $metadata } = (error ?? {}) as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return name === 'NoSuchKey' || name === 'NotFound' || $metadata?.httpStatusCode === 404;
}

function getDisposition(fileName: string, requested: unknown): string {
  if (typeof requested === 'string' && requested) {
    return `attachment; filename="${sanitizeContentDispositionFilename(requested)}"`;
  }
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (INLINE_TYPES[extension]) {
    return 'inline';
  }
  return `attachment; filename="${sanitizeContentDispositionFilename(fileName)}"`;
}

/**
 * Serves S3 objects to their owner through the app, so the bucket can refuse
 * every request that does not come through the VPC. Links carry the object's
 * key, whose user segment names the owner; the session cookie names the
 * viewer, and anyone else gets a 404. Mounted at `S3_PROXY_ROUTE`.
 */
export function createS3ProxyHandler({ authenticate, getObject = getS3Object }: S3ProxyDeps) {
  return async function serveS3File(req: Request, res: Response): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.set('Allow', 'GET, HEAD').status(405).end();
      return;
    }

    try {
      const auth = await authenticate(req);
      if (auth.status !== 'authenticated') {
        res.status(auth.status === 'missing' ? 401 : 403).send('Unauthorized');
        return;
      }

      const key = decodeKey(req.path);
      const parsed = key ? parseS3Key(key) : null;
      if (!key || !parsed || parsed.userId !== auth.userId) {
        res.status(404).send('Not Found');
        return;
      }

      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const head = req.method === 'HEAD';
      let object: S3Object;
      try {
        object = await getObject(key, { head, signal: controller.signal });
      } catch (error) {
        if (isNotFound(error)) {
          res.status(404).send('Not Found');
          return;
        }
        throw error;
      }

      const extension = parsed.fileName.split('.').pop()?.toLowerCase() ?? '';
      res.set({
        'Content-Type': INLINE_TYPES[extension] ?? 'application/octet-stream',
        'Content-Disposition': getDisposition(parsed.fileName, req.query.filename),
        'Content-Security-Policy': FILE_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      });
      if (object.contentLength != null) {
        res.set('Content-Length', String(object.contentLength));
      }
      if (head || !object.body) {
        res.status(200).end();
        return;
      }
      res.status(200);
      await pipeline(object.body, res);
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableFinished) {
          logger.warn('[S3 proxy] Stream ended early', getSafeErrorMetadata(error));
        }
        return;
      }
      logger.error('[S3 proxy] Error serving file', getSafeErrorMetadata(error));
      res.status(500).send('Internal Server Error');
    }
  };
}
