import { logger } from '@librechat/data-schemas';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import {
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListKnowledgeBasesCommand,
  ListDataSourcesCommand,
  ConflictException,
} from '@aws-sdk/client-bedrock-agent';
import { RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import type { IngestionJob } from '@aws-sdk/client-bedrock-agent';
import type {
  RetrievalFilter,
  KnowledgeBaseRetrievalResult,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { initializeS3 } from '~/cdn/s3';
import { initializeBedrockAgent, initializeBedrockAgentRuntime } from './client';

export interface BedrockKbConfig {
  knowledgeBaseId: string;
  dataSourceId: string;
  bucket: string;
  /** Prefix objects are written under within `bucket`, e.g. `'kb/'`. No leading slash; trailing slash optional. */
  prefix?: string;
}

const stripSlashes = (value: string): string => value.replace(/^\/+/, '').replace(/\/+$/, '');

const buildKey = (config: BedrockKbConfig, fileId: string, filename: string): string => {
  const prefix = config.prefix ? `${stripSlashes(config.prefix)}/` : '';
  return `${prefix}${fileId}/${filename.replace(/[\\/]+/g, '_')}`;
};

export interface IngestObjectParams {
  fileId: string;
  userId: string;
  filename: string;
  buffer: Buffer;
  contentType?: string;
  entityIds?: string[];
}

/**
 * Writes the file's bytes and its `.metadata.json` sidecar (Bedrock's native
 * per-object metadata convention) to the KB's S3 data source location. Does
 * NOT start an ingestion job — callers batch that via the ingestion queue
 * (see `ingestionQueue.ts`) since Bedrock rejects a second `StartIngestionJob`
 * while one is already in progress for the data source.
 */
export async function writeKbObject(config: BedrockKbConfig, params: IngestObjectParams): Promise<string> {
  const s3 = initializeS3();
  if (!s3) {
    throw new Error('[bedrock-kb] S3 client not initialized; cannot write KB object.');
  }
  const key = buildKey(config, params.fileId, params.filename);
  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: params.buffer,
      ...(params.contentType ? { ContentType: params.contentType } : {}),
    }),
  );
  const metadataAttributes: Record<string, unknown> = {
    file_id: { value: { type: 'STRING', stringValue: params.fileId }, includeForEmbedding: false },
    user_id: { value: { type: 'STRING', stringValue: params.userId }, includeForEmbedding: false },
  };
  if (params.entityIds && params.entityIds.length > 0) {
    metadataAttributes.entity_ids = {
      value: { type: 'STRING_LIST', stringListValue: params.entityIds },
      includeForEmbedding: false,
    };
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: `${key}.metadata.json`,
      Body: JSON.stringify({ metadataAttributes }),
      ContentType: 'application/json',
    }),
  );
  return key;
}

/** Deletes the object and its metadata sidecar. Ingestion resync (via the queue) removes it from the KB. */
export async function deleteKbObject(config: BedrockKbConfig, key: string): Promise<void> {
  const s3 = initializeS3();
  if (!s3) {
    throw new Error('[bedrock-kb] S3 client not initialized; cannot delete KB object.');
  }
  await Promise.all([
    s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })),
    s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: `${key}.metadata.json` })),
  ]);
}

/**
 * Starts an ingestion job for the configured data source. Bedrock rejects a
 * second concurrent job with `ConflictException` — returns `null` in that
 * case so the ingestion queue can retry on its next debounce tick instead of throwing.
 */
export async function startIngestionJob(config: BedrockKbConfig): Promise<IngestionJob | null> {
  const client = initializeBedrockAgent();
  if (!client) {
    throw new Error('[bedrock-kb] Bedrock Agent client not initialized; cannot start ingestion job.');
  }
  try {
    const result = await client.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: config.knowledgeBaseId,
        dataSourceId: config.dataSourceId,
      }),
    );
    return result.ingestionJob ?? null;
  } catch (error) {
    if (error instanceof ConflictException) {
      logger.info('[bedrock-kb] Ingestion job already in progress; will retry on next debounce tick.');
      return null;
    }
    throw error;
  }
}

export async function getIngestionJob(config: BedrockKbConfig, ingestionJobId: string): Promise<IngestionJob | null> {
  const client = initializeBedrockAgent();
  if (!client) {
    throw new Error('[bedrock-kb] Bedrock Agent client not initialized; cannot get ingestion job.');
  }
  const result = await client.send(
    new GetIngestionJobCommand({
      knowledgeBaseId: config.knowledgeBaseId,
      dataSourceId: config.dataSourceId,
      ingestionJobId,
    }),
  );
  return result.ingestionJob ?? null;
}

/** Builds a Bedrock `RetrievalFilter` scoping results to specific files and/or an entity (tool resource namespace). */
export function buildKbFilter(params: {
  fileIds?: string[];
  entityId?: string;
  userId?: string;
}): RetrievalFilter | undefined {
  const clauses: RetrievalFilter[] = [];
  if (params.fileIds && params.fileIds.length === 1) {
    clauses.push({ equals: { key: 'file_id', value: params.fileIds[0] } });
  } else if (params.fileIds && params.fileIds.length > 1) {
    clauses.push({ in: { key: 'file_id', value: params.fileIds } });
  }
  if (params.userId) {
    clauses.push({ equals: { key: 'user_id', value: params.userId } });
  }
  if (params.entityId) {
    clauses.push({ listContains: { key: 'entity_ids', value: params.entityId } });
  }
  if (clauses.length === 0) {
    return undefined;
  }
  return clauses.length === 1 ? clauses[0] : { andAll: clauses };
}

export interface RetrieveParams {
  query: string;
  topK?: number;
  filter?: RetrievalFilter;
}

export async function retrieveFromKnowledgeBase(
  config: BedrockKbConfig,
  params: RetrieveParams,
): Promise<KnowledgeBaseRetrievalResult[]> {
  if (!params.filter) {
    throw new Error('[bedrock-kb] Refusing unscoped retrieve; the shared knowledge base requires a filter.');
  }
  const client = initializeBedrockAgentRuntime();
  if (!client) {
    throw new Error('[bedrock-kb] Bedrock Agent Runtime client not initialized; cannot retrieve.');
  }
  const result = await client.send(
    new RetrieveCommand({
      knowledgeBaseId: config.knowledgeBaseId,
      retrievalQuery: { text: params.query },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          ...(params.topK ? { numberOfResults: params.topK } : {}),
          ...(params.filter ? { filter: params.filter } : {}),
        },
      },
    }),
  );
  return result.retrievalResults ?? [];
}

let cachedConfig: BedrockKbConfig | null | undefined;

/** Resolves `BEDROCK_KB_ID`/`BEDROCK_KB_DATA_SOURCE_ID` by name via `ListKnowledgeBases`/
 *  `ListDataSources` when the corresponding id env var isn't set — real AWS deployments set
 *  the id directly (provisioned externally, per the plan), but ministack's `CreateKnowledgeBase`
 *  returns a server-generated id with no way to pin it from compose, so local dev looks it up
 *  by name instead. Resolved once per process; a name pointing at nothing configured returns `null`
 *  every call rather than re-querying on each request. */
async function resolveKnowledgeBaseId(): Promise<string | null> {
  if (process.env.BEDROCK_KB_ID) {
    return process.env.BEDROCK_KB_ID;
  }
  const name = process.env.BEDROCK_KB_NAME;
  const client = name ? initializeBedrockAgent() : null;
  if (!name || !client) {
    return null;
  }
  const result = await client.send(new ListKnowledgeBasesCommand({}));
  return result.knowledgeBaseSummaries?.find((kb) => kb.name === name)?.knowledgeBaseId ?? null;
}

async function resolveDataSourceId(knowledgeBaseId: string): Promise<string | null> {
  if (process.env.BEDROCK_KB_DATA_SOURCE_ID) {
    return process.env.BEDROCK_KB_DATA_SOURCE_ID;
  }
  const name = process.env.BEDROCK_KB_DATA_SOURCE_NAME;
  const client = name ? initializeBedrockAgent() : null;
  if (!name || !client) {
    return null;
  }
  const result = await client.send(new ListDataSourcesCommand({ knowledgeBaseId }));
  return result.dataSourceSummaries?.find((ds) => ds.name === name)?.dataSourceId ?? null;
}

export async function resolveBedrockKbConfig(): Promise<BedrockKbConfig | null> {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }
  const bucket = process.env.BEDROCK_KB_DATA_SOURCE_BUCKET || process.env.AWS_BUCKET_NAME;
  const knowledgeBaseId = bucket ? await resolveKnowledgeBaseId() : null;
  const dataSourceId = knowledgeBaseId ? await resolveDataSourceId(knowledgeBaseId) : null;
  cachedConfig =
    knowledgeBaseId && dataSourceId && bucket
      ? {
          knowledgeBaseId,
          dataSourceId,
          bucket,
          prefix: process.env.BEDROCK_KB_DATA_SOURCE_PREFIX || 'kb/',
        }
      : null;
  return cachedConfig;
}
