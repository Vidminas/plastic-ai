import { writeKbObject, deleteKbObject, resolveBedrockKbConfig } from './service';
import type { IngestObjectParams } from './service';
import { scheduleIngestion, DEFAULT_INGESTION_DEBOUNCE_SECONDS } from './ingestionQueue';

export interface IngestFileResult {
  embedded: boolean;
  s3Key: string;
  ingestionStatus: 'pending';
  kbIngestionRequestedAt: string;
}

/**
 * Writes the file to the KB's S3 data source and schedules ingestion. Returns `null` when
 * `BEDROCK_KB_ID`/`BEDROCK_KB_DATA_SOURCE_ID` aren't configured, so callers can fail closed
 * the same way the legacy `RAG_API_URL`-unset case did.
 */
export async function ingestFileToKnowledgeBase(
  params: IngestObjectParams,
  debounceSeconds: number = DEFAULT_INGESTION_DEBOUNCE_SECONDS,
): Promise<IngestFileResult | null> {
  const config = await resolveBedrockKbConfig();
  if (!config) {
    return null;
  }
  const s3Key = await writeKbObject(config, params);
  scheduleIngestion(config, debounceSeconds);
  return {
    embedded: false,
    s3Key,
    ingestionStatus: 'pending',
    kbIngestionRequestedAt: new Date().toISOString(),
  };
}

export async function removeFileFromKnowledgeBase(
  s3Key: string,
  debounceSeconds: number = DEFAULT_INGESTION_DEBOUNCE_SECONDS,
): Promise<void> {
  const config = await resolveBedrockKbConfig();
  if (!config) {
    return;
  }
  await deleteKbObject(config, s3Key);
  scheduleIngestion(config, debounceSeconds);
}
