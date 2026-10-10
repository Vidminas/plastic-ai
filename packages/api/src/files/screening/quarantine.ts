import { createReadStream } from 'node:fs';
import { DeleteObjectCommand, GetObjectTaggingCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';

/** Where an upload waits, unreadable to the rest of the app, until it has been screened. */
export interface QuarantineStore {
  put(key: string, file: { path: string; size: number }): Promise<void>;
  remove(key: string): Promise<void>;
}

export type MalwareVerdict = 'clean' | 'infected' | 'unscannable' | 'timeout';

/** Decides whether a quarantined object is safe to process. */
export interface MalwareScanner {
  verdict(key: string, timeoutMs: number): Promise<MalwareVerdict>;
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

/** The tag GuardDuty Malware Protection for S3 writes on each object it has scanned. */
const GUARDDUTY_TAG = 'GuardDutyMalwareScanStatus';
const FIRST_POLL_MS = 500;
const MAX_POLL_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for GuardDuty Malware Protection's verdict on a quarantined object by polling its
 * tags. `UNSUPPORTED`, `ACCESS_DENIED` and `FAILED` mean the object was not scanned, so the
 * caller should treat them as it would a timeout.
 */
export function createGuardDutyScanner({
  client,
  bucket,
  wait = sleep,
  now = Date.now,
}: {
  client: Pick<S3Client, 'send'>;
  bucket: string;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}): MalwareScanner {
  return {
    async verdict(key, timeoutMs) {
      const deadline = now() + timeoutMs;
      let delay = FIRST_POLL_MS;
      while (now() < deadline) {
        const { TagSet = [] } = await client.send(
          new GetObjectTaggingCommand({ Bucket: bucket, Key: key }),
        );
        const status = TagSet.find((tag) => tag.Key === GUARDDUTY_TAG)?.Value;
        if (status === 'NO_THREATS_FOUND') {
          return 'clean';
        }
        if (status === 'THREATS_FOUND') {
          return 'infected';
        }
        if (status != null) {
          return 'unscannable';
        }
        await wait(Math.min(delay, Math.max(0, deadline - now())));
        delay = Math.min(delay * 2, MAX_POLL_MS);
      }
      return 'timeout';
    },
  };
}

/** For environments without GuardDuty, such as local ministack: every object passes. */
export const noMalwareScanner: MalwareScanner = { verdict: async () => 'clean' };
