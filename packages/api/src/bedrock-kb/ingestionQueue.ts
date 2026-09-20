import { logger } from '@librechat/data-schemas';
import { startIngestionJob } from './service';
import type { BedrockKbConfig } from './service';

/** Matches `bedrockKnowledgeBase.ingestionDebounceSeconds`'s schema default
 *  (`packages/data-provider/src/config.ts`) — used by callers without access to
 *  the resolved app config, e.g. `files/rag.ts`'s shared deletion utility. */
export const DEFAULT_INGESTION_DEBOUNCE_SECONDS = 8;

const pending = new Map<string, NodeJS.Timeout>();

/** One pending ingestion job per (knowledgeBaseId, dataSourceId) pair. */
const keyFor = (config: BedrockKbConfig): string => `${config.knowledgeBaseId}:${config.dataSourceId}`;

/**
 * Trailing-edge debounce: repeated calls within `debounceSeconds` collapse into a single
 * `StartIngestionJob`. `startIngestionJob` already treats Bedrock's `ConflictException`
 * (a job already running for the data source) as a signal to retry rather than an error,
 * so a burst landing mid-job just reschedules itself once more instead of failing.
 */
export function scheduleIngestion(config: BedrockKbConfig, debounceSeconds: number): void {
  const key = keyFor(config);
  const existingTimer = pending.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    pending.delete(key);
    startIngestionJob(config)
      .then((job) => {
        if (job == null) {
          scheduleIngestion(config, debounceSeconds);
        }
      })
      .catch((error: unknown) => {
        logger.error('[bedrock-kb] Failed to start ingestion job', error);
      });
  }, debounceSeconds * 1000);
  timer.unref?.();
  pending.set(key, timer);
}
