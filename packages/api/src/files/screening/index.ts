import { promises as fs } from 'fs';
import { logger } from '@librechat/data-schemas';
import { ErrorTypes } from 'librechat-data-provider';
import type {
  TUploadRejection,
  TUploadScreening,
  UploadRejectionReason,
} from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { MalwareScanner, QuarantineStore } from './quarantine';
import { createGuardDutyScanner, createS3Quarantine, noMalwareScanner } from './quarantine';
import { checkFileContent } from './content';
import { initializeS3 } from '../../cdn/s3';

export * from './content';
export * from './quarantine';

export type UploadScreeningResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: Omit<TUploadRejection, 'message'> };

export interface UploadScreeningServices {
  readonly quarantine: QuarantineStore;
  readonly scanner: MalwareScanner;
}

const reject = (reason: UploadRejectionReason): UploadScreeningResult => ({
  ok: false,
  error: { code: ErrorTypes.UPLOAD_REJECTED, reason },
});

/**
 * Screens one upload before anything else processes or stores it:
 * 1. its first bytes must match its extension;
 * 2. it is copied to quarantine and must pass the malware scan.
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
    return { ok: true };
  } finally {
    await services.quarantine.remove(key);
  }
}

/**
 * Builds the AWS clients `config` names. The quarantine bucket is `AWS_QUARANTINE_BUCKET_NAME`;
 * the S3 client is the app's own (`initializeS3`), so it shares its endpoint and credentials.
 */
export function createUploadScreeningServices(
  config: TUploadScreening,
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
  };
}

type ScreeningRequest = Request & {
  file?: Express.Multer.File;
  file_id?: string;
  user?: { id?: string };
  config?: { uploadScreening?: TUploadScreening };
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
  createServices?: (config: TUploadScreening) => UploadScreeningServices;
} = {}): UploadScreeningCheck {
  const servicesByConfig = new WeakMap<TUploadScreening, UploadScreeningServices>();
  const getServices = (config: TUploadScreening): UploadScreeningServices => {
    let services = servicesByConfig.get(config);
    if (services == null) {
      services = createServices(config);
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
        services: getServices(screening),
      });
    } catch (error) {
      logger.error('[uploadScreening] Could not screen an upload', { file_id, error });
      result = reject('scan_unavailable');
    }
    if (result.ok) {
      return next();
    }
    const { reason } = result.error;
    logger.info(`[uploadScreening] Refused an upload: ${reason}`, { file_id, reason });
    await fs.unlink(file.path).catch((error: unknown) => {
      logger.warn('[uploadScreening] Could not remove a refused upload', error);
    });
    const body: TUploadRejection = { message: `com_error_files_${reason}`, ...result.error };
    return res.status(reason === 'scan_unavailable' ? 503 : 422).json(body);
  };
}
