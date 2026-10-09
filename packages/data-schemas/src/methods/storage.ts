import type { Model } from 'mongoose';
import type { IMongoFile } from '~/types';

/** Storage accounting for `fileConfig.userStorageLimit`. */
export function createStorageMethods(mongoose: typeof import('mongoose')): {
  getUserStorageBytes: (userId: string) => Promise<number>;
} {
  /**
   * Bytes of every stored file the user owns, whatever created it: uploads and files a tool
   * wrote for them alike, since both occupy storage. A user with no files holds 0.
   */
  async function getUserStorageBytes(userId: string): Promise<number> {
    const File = mongoose.models.File as Model<IMongoFile>;
    const [result] = await File.aggregate<{ total: number }>([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, total: { $sum: '$bytes' } } },
    ]);
    return result?.total ?? 0;
  }

  return { getUserStorageBytes };
}

export type StorageMethods = ReturnType<typeof createStorageMethods>;
