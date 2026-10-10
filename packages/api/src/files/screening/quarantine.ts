import { createReadStream } from 'node:fs';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';

/** Where an upload waits, unreadable to the rest of the app, until it has been screened. */
export interface QuarantineStore {
  put(key: string, file: { path: string; size: number }): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createS3Quarantine({
  client,
  bucket,
}: {
  client: Pick<S3Client, 'send'>;
  bucket: string;
}): QuarantineStore {
  return {
    async put(key, file) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(file.path),
          ContentLength: file.size,
        }),
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
