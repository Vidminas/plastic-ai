import { promises as fs } from 'fs';
import { logger } from '@librechat/data-schemas';
import { ErrorTypes, mergeFileConfig } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { TFileConfig } from 'librechat-data-provider';

type QuotaRequest = Request & {
  user?: { id?: string };
  config?: { fileConfig?: TFileConfig };
};

type StorageQuotaCheck = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Upload route middleware, placed after multer, that refuses a file which would take the
 * user's stored files past `fileConfig.userStorageLimit`. The refused file is removed from
 * the temporary upload directory before it is processed or stored. Two uploads racing each
 * other can each fit on their own and together pass the limit by one file.
 */
export function createStorageQuotaCheck({
  getUserStorageBytes,
}: {
  getUserStorageBytes: (userId: string) => Promise<number>;
}): StorageQuotaCheck {
  return async function storageQuotaCheck(req, res, next) {
    const { file, user, config } = req as QuotaRequest;
    const limitBytes = mergeFileConfig(config?.fileConfig).userStorageLimit;
    if (limitBytes == null || file == null || !user?.id) {
      return next();
    }
    try {
      const usedBytes = await getUserStorageBytes(user.id);
      if (usedBytes + file.size <= limitBytes) {
        return next();
      }
      if (file.path) {
        await fs.unlink(file.path).catch((error: unknown) => {
          logger.warn('[storageQuotaCheck] Could not remove a refused upload', error);
        });
      }
      /** `message` is the composer's translation key; `code` is the stable identifier. */
      return res.status(413).json({
        message: 'com_error_files_storage_limit',
        code: ErrorTypes.STORAGE_QUOTA_EXCEEDED,
        usedBytes,
        limitBytes,
      });
    } catch (error) {
      return next(error);
    }
  };
}
