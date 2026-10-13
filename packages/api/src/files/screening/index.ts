import { promises as fs } from 'fs';
import { logger } from '@librechat/data-schemas';
import { ErrorTypes } from 'librechat-data-provider';
import { TextractClient } from '@aws-sdk/client-textract';
import type {
  TPiiMasking,
  TUploadRejection,
  TUploadScreening,
  UploadRejectionReason,
} from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { MalwareScanner, QuarantineStore } from './quarantine';
import type { ImageTextReader } from './ocr';
import type { PiiDetector } from './pii';
import { createGuardDutyScanner, createS3Quarantine, noMalwareScanner } from './quarantine';
import { createGuardrailDetector, noPiiDetector } from './pii';
import { getGuardrailTarget } from '~/guardrails/runtime';
import { extractScreeningText } from './extract';
import { createTextractReader } from './ocr';
import { checkFileContent } from './content';
import { initializeS3 } from '../../cdn/s3';

export * from './content';
export * from './extract';
export * from './ocr';
export * from './pii';
export * from './quarantine';

export type UploadScreeningResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: Omit<TUploadRejection, 'message'> };

export interface UploadScreeningServices {
  readonly quarantine: QuarantineStore;
  readonly scanner: MalwareScanner;
  readonly detector: PiiDetector;
  /** Reads the text in images for screening; `null` checks images for type and malware only. */
  readonly imageReader: ImageTextReader | null;
}

const reject = (reason: UploadRejectionReason, identifiers?: string[]): UploadScreeningResult => ({
  ok: false,
  error: { code: ErrorTypes.UPLOAD_REJECTED, reason, ...(identifiers ? { identifiers } : {}) },
});

/**
 * Screens one upload before anything else processes or stores it:
 * 1. its first bytes must match its extension;
 * 2. it is copied to quarantine and must pass the malware scan;
 * 3. a document or text file must yield readable text, and so must an image when an
 *    `imageReader` is set; that text must contain none of the configured identifiers
 *    (the guardrail's built-in PII types).
 *
 * The quarantined copy is always deleted before this returns. Throws only when a service
 * fails; every refusal is a result.
 */
export async function screenUpload({
  file,
  key,
  config,
  services,
}: {
  file: Express.Multer.File;
  key: string;
  config: TUploadScreening;
  services: UploadScreeningServices;
}): Promise<UploadScreeningResult> {
  const content = await checkFileContent(file.path, file.originalname);
  if (!content.ok) {
    return reject(content.reason);
  }

  await services.quarantine.put(key, file);
  try {
    const verdict = await services.scanner.verdict(key, config.scanTimeoutSeconds * 1000);
    if (verdict === 'infected') {
      return reject('malware');
    }
    if (verdict !== 'clean') {
      return reject('scan_unavailable');
    }
    let extracted: { ok: true; text: string } | { ok: false };
    if (content.kind === 'image') {
      if (services.imageReader == null) {
        return { ok: true };
      }
      extracted = await services.imageReader.read(file.path);
    } else {
      extracted = await extractScreeningText(file, content.kind);
    }
    if (!extracted.ok) {
      return reject('unreadable');
    }
    return await screenText(extracted.text, { config, detector: services.detector });
  } finally {
    await services.quarantine.remove(key);
  }
}

/** Refuses text that is too long to screen or contains one of the configured identifiers. */
async function screenText(
  text: string,
  { config, detector }: { config: TUploadScreening; detector: PiiDetector },
): Promise<UploadScreeningResult> {
  if (text.length > config.pii.maxCharacters) {
    return reject('too_long');
  }
  if (!text.trim()) {
    return { ok: true };
  }
  const identifiers = await detector.detect(text);
  return identifiers.length > 0 ? reject('identifiers', identifiers) : { ok: true };
}

/**
 * Textract allows 1 DetectDocumentText call a second per account in eu-west-2 by default, so
 * its client rate-limits itself and retries throttled calls rather than refuse the upload,
 * as the guardrail client does. The clients are shared by every request.
 */
const SCREENING_RETRY = { retryMode: 'adaptive', maxAttempts: 8 } as const;

/**
 * Builds the AWS clients `config` names. The quarantine bucket is `AWS_QUARANTINE_BUCKET_NAME`;
 * the S3 client is the app's own (`initializeS3`), so it shares its endpoint and credentials.
 * The guardrail is `config.pii.guardrail`, else `maskingGuardrail` (`piiMasking.guardrail`).
 */
export function createUploadScreeningServices(
  config: TUploadScreening,
  maskingGuardrail?: TPiiMasking['guardrail'],
  env: NodeJS.ProcessEnv = process.env,
): UploadScreeningServices {
  const bucket = env.AWS_QUARANTINE_BUCKET_NAME;
  if (!bucket) {
    throw new Error('uploadScreening is configured but AWS_QUARANTINE_BUCKET_NAME is not set');
  }
  const s3 = initializeS3();
  if (s3 == null) {
    throw new Error('uploadScreening needs S3, but AWS_REGION is not set');
  }
  return {
    quarantine: createS3Quarantine({ client: s3, bucket }),
    scanner:
      config.malware === 'guardduty'
        ? createGuardDutyScanner({ client: s3, bucket })
        : noMalwareScanner,
    detector: createDetector(config, maskingGuardrail, env),
    imageReader:
      config.pii.images === 'textract'
        ? createTextractReader({
            client: new TextractClient({ region: env.AWS_REGION, ...SCREENING_RETRY }),
          })
        : null,
  };
}

function createDetector(
  config: TUploadScreening,
  maskingGuardrail: TPiiMasking['guardrail'] | undefined,
  env: NodeJS.ProcessEnv,
): PiiDetector {
  if (config.pii.detector === 'none') {
    return noPiiDetector;
  }
  const target = getGuardrailTarget(config.pii.guardrail ?? maskingGuardrail, env);
  if (target == null) {
    throw new Error(
      'uploadScreening.pii.detector is guardrail, but neither uploadScreening.pii.guardrail nor piiMasking.guardrail names one',
    );
  }
  return createGuardrailDetector({ ...target, entities: config.pii.entities });
}

type ScreeningRequest = Request & {
  file?: Express.Multer.File;
  file_id?: string;
  user?: { id?: string };
  config?: {
    uploadScreening?: TUploadScreening;
    piiMasking?: TPiiMasking;
  };
};

type UploadScreeningCheck = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Upload route middleware, placed after multer, that runs `screenUpload` when
 * `uploadScreening` is configured. A refused file is removed from the temporary upload
 * directory and answered with 422 (503 when a screening service is down), with the
 * composer's translation key as `message` and the stable `code` and `reason`.
 */
export function createUploadScreeningCheck({
  createServices = createUploadScreeningServices,
}: {
  createServices?: (
    config: TUploadScreening,
    maskingGuardrail?: TPiiMasking['guardrail'],
  ) => UploadScreeningServices;
} = {}): UploadScreeningCheck {
  const servicesByConfig = new WeakMap<TUploadScreening, UploadScreeningServices>();
  const getServices = (
    config: TUploadScreening,
    maskingGuardrail?: TPiiMasking['guardrail'],
  ): UploadScreeningServices => {
    let services = servicesByConfig.get(config);
    if (services == null) {
      services = createServices(config, maskingGuardrail);
      servicesByConfig.set(config, services);
    }
    return services;
  };

  return async function uploadScreeningCheck(req, res, next) {
    const { file, file_id, user, config } = req as ScreeningRequest;
    const screening = config?.uploadScreening;
    if (screening == null || file == null || !user?.id) {
      return next();
    }
    const key = `${user.id}/${file_id ?? file.filename}`;
    let result: UploadScreeningResult;
    try {
      result = await screenUpload({
        file,
        key,
        config: screening,
        services: getServices(screening, config?.piiMasking?.guardrail),
      });
    } catch (error) {
      logger.error('[uploadScreening] Could not screen an upload', { file_id, error });
      result = reject('scan_unavailable');
    }
    if (result.ok) {
      return next();
    }
    const { reason, identifiers } = result.error;
    logger.info(`[uploadScreening] Refused an upload: ${reason}`, {
      file_id,
      reason,
      identifiers,
    });
    await fs.unlink(file.path).catch((error: unknown) => {
      logger.warn('[uploadScreening] Could not remove a refused upload', error);
    });
    const body: TUploadRejection = { message: `com_error_files_${reason}`, ...result.error };
    return res.status(reason === 'scan_unavailable' ? 503 : 422).json(body);
  };
}
