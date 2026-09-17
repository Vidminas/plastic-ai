import { createHash } from 'node:crypto';
import { EToolResources, FileContext, FileSources } from 'librechat-data-provider';
import {
  BatchGetCommand,
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { assertItemSize, cleanItem, DEFAULT_DYNAMO_TABLE, project, valueNumber, valueString } from './core';
import type { DynamoCoreConfig, DynamoItem, DynamoValue } from './core';

const GSI1 = 'GSI1';
const GSI2 = 'GSI2';

/** Rich filter type for File queries — richer than `DynamoFilter` (core.ts), since
 *  Mongoose `FilterQuery<IMongoFile>` usage across the codebase relies on `$ne`,
 *  `$exists`, `$lte` and `$or` in addition to equality and `$in`. */
export type FileOperatorValue =
  | DynamoValue
  | { $in?: DynamoValue[]; $ne?: DynamoValue; $exists?: boolean; $lte?: DynamoValue };
export interface FileFilter {
  [key: string]: FileOperatorValue | FileFilter[] | undefined;
  $or?: FileFilter[];
}

export type DynamoFileOwnerScope = { userId: string; tenantId?: string | null };

const fileKey = (file_id: string): DynamoItem => ({ PK: `FILE#${file_id}`, SK: 'DETAIL' });

const codeFileLocatorKey = (
  filename: string,
  conversationId: string,
  tenantId: string | null,
): DynamoItem => ({ PK: `CODEFILE#${tenantId ?? 'none'}#${conversationId}#${filename}`, SK: 'LOCATOR' });

const toStoredItem = (item: DynamoItem): DynamoItem => JSON.parse(JSON.stringify(item)) as DynamoItem;

const isConditionalCheckFailed = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConditionalCheckFailedException';

const getPath = (item: DynamoItem, path: string): DynamoValue | undefined =>
  path.split('.').reduce<DynamoValue | undefined>((acc, key) => {
    if (acc == null || typeof acc !== 'object' || Array.isArray(acc) || acc instanceof Date) {
      return undefined;
    }
    return (acc as DynamoItem)[key];
  }, item);

const asInList = (value: FileOperatorValue | undefined): DynamoValue[] | undefined =>
  value != null && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as { $in?: unknown }).$in)
    ? ((value as { $in: DynamoValue[] }).$in)
    : undefined;

const isOperatorObject = (value: FileOperatorValue | undefined): value is Exclude<FileOperatorValue, DynamoValue> =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  Object.keys(value).some((key) => key.startsWith('$'));

const matchesFieldOperators = (actual: DynamoValue | undefined, ops: DynamoItem): boolean => {
  let result = true;
  if ('$in' in ops) {
    const list = Array.isArray(ops.$in) ? ops.$in : [];
    result = result && list.includes(actual as DynamoValue);
  }
  if ('$ne' in ops) {
    result = result && actual !== ops.$ne;
  }
  if ('$exists' in ops) {
    const exists = actual !== undefined && actual !== null;
    result = result && (ops.$exists ? exists : !exists);
  }
  if ('$lte' in ops) {
    const a = actual instanceof Date ? actual.getTime() : actual;
    const b = ops.$lte instanceof Date ? (ops.$lte as Date).getTime() : ops.$lte;
    result = result && typeof a === 'number' && typeof b === 'number' && a <= b;
  }
  return result;
};

/** In-memory Mongo-like filter matcher for File items (equality, `$in`, `$ne`,
 *  `$exists`, `$lte`, `$or`, dot-path fields) — richer than `dynamo/core.ts`'s
 *  `matches()`, which only supports equality and `$in`. */
const matchesQuery = (item: DynamoItem, filter: FileFilter): boolean =>
  Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      const clauses = Array.isArray(expected) ? (expected as FileFilter[]) : [];
      return clauses.some((clause) => matchesQuery(item, clause));
    }
    const actual = getPath(item, key);
    if (isOperatorObject(expected as FileOperatorValue | undefined)) {
      return matchesFieldOperators(actual, expected as unknown as DynamoItem);
    }
    return actual === expected;
  });

const hydrateFile = (item: DynamoItem): DynamoItem => {
  const cleaned = cleanItem(item);
  return typeof cleaned.deletionRetryAt === 'string'
    ? { ...cleaned, deletionRetryAt: new Date(cleaned.deletionRetryAt) }
    : cleaned;
};

const expiryIndex = (record: DynamoItem): DynamoItem => {
  const expiredAt = record.expiredAt instanceof Date ? record.expiredAt.toISOString() : valueString(record.expiredAt);
  const file_id = valueString(record.file_id);
  return expiredAt != null && file_id != null ? { GSI2PK: 'FILE_EXPIRY', GSI2SK: `${expiredAt}#${file_id}` } : {};
};

const normalizeSelect = (fields?: string | DynamoItem | null): string | undefined => {
  if (fields == null) {
    return undefined;
  }
  if (typeof fields === 'string') {
    return fields;
  }
  return Object.entries(fields)
    .map(([key, value]) => (value === 0 || value === false ? `-${key}` : key))
    .join(' ');
};

const assertValidCodeEnvironmentRouteKey = (routeKey: string): void => {
  if (routeKey.length === 0 || routeKey.includes('.') || routeKey.startsWith('$')) {
    throw new Error(`Invalid code environment route key "${routeKey}"`);
  }
};

const runArtifactFileId = (scope: {
  userId: string;
  tenantId?: string | null;
  conversationId: string;
  runId: string;
  executionId: string;
  agentId: string;
  sourceFileId: string;
}): string => {
  const bytes = createHash('sha256')
    .update(
      JSON.stringify([
        'librechat-run-artifact:v1',
        scope.userId,
        scope.tenantId ?? null,
        scope.conversationId,
        scope.runId,
        scope.executionId,
        scope.agentId,
        scope.sourceFileId,
      ]),
    )
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

type DynamoRunArtifactScope = {
  userId: string;
  tenantId?: string | null;
  conversationId: string;
  runId: string;
  executionId: string;
  agentId: string;
  sourceFileId: string;
};

/** `isolatedDeclarations` requires an exported factory's return type to be
 *  statically inferable without cross-file analysis, which an object-literal
 *  return with shorthand properties (`{ getFiles, createFile, ... }`) isn't —
 *  see `DynamoCoreMethods` in `dynamo/core.ts` for the same requirement. */
export interface DynamoFileMethods {
  findFileById: (file_id: string, options?: FileFilter) => Promise<DynamoItem | null>;
  getFiles: (
    filter: FileFilter,
    sortOptions?: DynamoItem | null,
    selectFields?: string | DynamoItem | null,
  ) => Promise<DynamoItem[]>;
  getExpiredFiles: (limit?: number, options?: { now?: Date }) => Promise<DynamoItem[]>;
  incrementFileDeletionAttempts: (file_id: string) => Promise<number>;
  deferExpiredFile: (file_id: string, deletionRetryAt: Date) => Promise<void>;
  getToolFilesByIds: (
    fileIds: string[],
    toolResourceSet?: Set<EToolResources>,
    ownerScope?: DynamoFileOwnerScope,
  ) => Promise<DynamoItem[]>;
  getCodeGeneratedFiles: (
    conversationId: string,
    threadFileIds?: string[],
    ownerScope?: DynamoFileOwnerScope,
  ) => Promise<DynamoItem[]>;
  getUserCodeFiles: (fileIds: string[], ownerScope: DynamoFileOwnerScope) => Promise<DynamoItem[]>;
  getDeferredProvisionFiles: (
    fileIds: string[],
    ownerScope: DynamoFileOwnerScope,
    resources?: {
      code?: boolean;
      search?: boolean;
      codeRouteKey?: string;
      searchNamespaces?: string[];
      hydrateProvisioned?: boolean;
    },
  ) => Promise<DynamoItem[]>;
  claimCodeFile: (data: {
    filename: string;
    conversationId: string;
    file_id: string;
    user: string;
    tenantId?: string | null;
    sourceDispatchedAt?: number;
  }) => Promise<DynamoItem>;
  createFile: (data: DynamoItem, disableTTL?: boolean) => Promise<DynamoItem | null>;
  updateFile: (data: DynamoItem & { file_id: string }, extraFilter?: FileFilter) => Promise<DynamoItem | null>;
  commitCodeFile: (data: DynamoItem & { file_id: string }, sourceDispatchedAt?: number) => Promise<boolean>;
  updateFileCodeEnvRef: (data: {
    file_id: string;
    routeKey: string;
    ref: DynamoItem;
    legacyRef?: DynamoItem;
  }) => Promise<DynamoItem | null>;
  addFileEmbeddedEntity: (data: { file_id: string; entityId: string }) => Promise<DynamoItem | null>;
  updateFileUsage: (data: {
    file_id: string;
    inc?: number;
    user?: string;
    tenantId?: string | null;
  }) => Promise<DynamoItem | null>;
  deleteFile: (file_id: string) => Promise<DynamoItem | null>;
  deleteFileByFilter: (filter: FileFilter) => Promise<DynamoItem | null>;
  deleteFiles: (file_ids: string[], user?: string) => Promise<{ deletedCount?: number }>;
  batchUpdateFiles: (
    updates: Array<{ file_id: string; filepath: string; storageKey?: string; storageRegion?: string }>,
  ) => Promise<void>;
  updateFilesUsage: (
    files: Array<{ file_id: string }>,
    fileIds?: string[],
    options?: { user?: string; tenantId?: string | null },
  ) => Promise<DynamoItem[]>;
  extendFilesTTL: (
    fileIds: string[],
    hold: { renewMs: number; maxLifetimeMs: number },
    owner: { user: string; tenantId?: string | null },
  ) => Promise<number>;
  sweepOrphanedPreviews: (maxAgeMs?: number) => Promise<number>;
  getRunFileCandidates: (fileIds: readonly string[], tenantId?: string | null) => Promise<DynamoItem[]>;
  claimRunArtifactFile: (scope: DynamoRunArtifactScope) => Promise<{ file_id: string; file?: DynamoItem }>;
  publishRunArtifactFile: (input: {
    scope: DynamoRunArtifactScope;
    file: DynamoItem;
    provenance: DynamoItem;
  }) => Promise<DynamoItem>;
  findRunArtifactFile: (scope: DynamoRunArtifactScope) => Promise<DynamoItem | null>;
  listRunArtifacts: (
    scope: Omit<DynamoRunArtifactScope, 'executionId' | 'agentId' | 'sourceFileId'>,
  ) => Promise<DynamoItem[]>;
}

export function createDynamoFileMethods(
  client: DynamoDBDocumentClient,
  config: DynamoCoreConfig = {},
): DynamoFileMethods {
  const TableName = config.tableName ?? DEFAULT_DYNAMO_TABLE;

  const getRawItem = async (key: DynamoItem): Promise<DynamoItem | null> => {
    const result = await client.send(new GetCommand({ TableName, Key: key, ConsistentRead: true }));
    return result.Item == null ? null : (result.Item as DynamoItem);
  };

  const getFileItem = (file_id: string): Promise<DynamoItem | null> => getRawItem(fileKey(file_id));

  const putRawItem = async (item: DynamoItem): Promise<void> => {
    const stored = toStoredItem(item);
    assertItemSize(stored);
    await client.send(new PutCommand({ TableName, Item: stored }));
  };

  const queryOwnerFiles = async (userId: string): Promise<DynamoItem[]> => {
    const result = await client.send(
      new QueryCommand({
        TableName,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :user AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':user': `USER#${userId}`, ':prefix': 'FILE#' },
      }),
    );
    return (result.Items ?? []) as DynamoItem[];
  };

  const batchGetFiles = async (fileIds: readonly string[]): Promise<DynamoItem[]> => {
    const unique = [...new Set(fileIds)];
    const results: DynamoItem[] = [];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const chunk = unique.slice(offset, offset + 100);
      if (chunk.length === 0) {
        continue;
      }
      const result = await client.send(
        new BatchGetCommand({ RequestItems: { [TableName]: { Keys: chunk.map(fileKey) } } }),
      );
      results.push(...((result.Responses?.[TableName] ?? []) as DynamoItem[]));
    }
    return results;
  };

  const writeFileRecord = async (merged: DynamoItem, file_id: string): Promise<DynamoItem> => {
    const item: DynamoItem = {
      ...fileKey(file_id),
      ...merged,
      GSI1PK: `USER#${valueString(merged.user) ?? ''}`,
      GSI1SK: `FILE#${valueString(merged.updatedAt) ?? new Date().toISOString()}#${file_id}`,
      ...expiryIndex(merged),
    };
    await putRawItem(item);
    return hydrateFile(item);
  };

  /** Finds a file by its file_id, optionally checked against extra equality/operator fields. */
  const findFileById = async (file_id: string, options: FileFilter = {}): Promise<DynamoItem | null> => {
    const item = await getFileItem(file_id);
    if (item == null) {
      return null;
    }
    const file = hydrateFile(item);
    return Object.keys(options).length === 0 || matchesQuery(file, options) ? file : null;
  };

  /** Supports the filter shapes actually used across the codebase: `file_id`/`_id`
   *  (single or `$in`) via BatchGet, or `user` via the GSI1 owner-listing query —
   *  any remaining filter fields are applied in-memory. An unrecognized shape
   *  throws, matching the precedent `getConvosByCursor` sets for unsupported
   *  Mongo-style queries under DynamoDB. */
  const getFiles = async (
    filter: FileFilter,
    _sortOptions?: DynamoItem | null,
    selectFields?: string | DynamoItem | null,
  ): Promise<DynamoItem[]> => {
    const remaining: FileFilter = { ...filter };
    const fileIdIn = asInList(filter.file_id as FileOperatorValue | undefined);
    const singleFileId = fileIdIn == null && typeof filter.file_id === 'string' ? filter.file_id : undefined;
    const directId =
      typeof filter._id === 'string' ? filter._id : typeof filter.id === 'string' ? filter.id : undefined;
    let items: DynamoItem[];
    if (fileIdIn != null) {
      delete remaining.file_id;
      items = await batchGetFiles(fileIdIn.filter((value): value is string => typeof value === 'string'));
    } else if (singleFileId != null) {
      delete remaining.file_id;
      items = await batchGetFiles([singleFileId]);
    } else if (directId != null) {
      delete remaining._id;
      delete remaining.id;
      items = await batchGetFiles([directId]);
    } else if (typeof filter.user === 'string') {
      delete remaining.user;
      items = await queryOwnerFiles(filter.user);
    } else {
      throw new Error('Unsupported file filter shape for DynamoDB');
    }
    const hydrated = items.map(hydrateFile);
    const filtered = Object.keys(remaining).length === 0 ? hydrated : hydrated.filter((item) => matchesQuery(item, remaining));
    const sorted = [...filtered].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const select = normalizeSelect(selectFields) ?? '-text';
    return sorted.map((item) => project(item, select) ?? item);
  };

  /** Expired files the retention sweep may attempt right now, oldest deadline
   *  first, held back only by `deletionRetryAt` — see `getExpiredFiles` in
   *  `methods/file.ts` for the full rationale this ports faithfully. */
  const getExpiredFiles = async (limit = 100, { now = new Date() }: { now?: Date } = {}): Promise<DynamoItem[]> => {
    const result = await client.send(
      new QueryCommand({
        TableName,
        IndexName: GSI2,
        KeyConditionExpression: 'GSI2PK = :expiry AND GSI2SK <= :cutoff',
        ExpressionAttributeValues: { ':expiry': 'FILE_EXPIRY', ':cutoff': `${now.toISOString()}~` },
        Limit: Math.max(limit * 4, limit),
      }),
    );
    const items = ((result.Items ?? []) as DynamoItem[]).map(hydrateFile);
    const eligible = items.filter((item) => {
      const retryAt = item.deletionRetryAt;
      return !(retryAt instanceof Date) || retryAt.getTime() <= now.getTime();
    });
    return eligible.sort((a, b) => String(a.expiredAt ?? '').localeCompare(String(b.expiredAt ?? ''))).slice(0, limit);
  };

  const incrementFileDeletionAttempts = async (file_id: string): Promise<number> => {
    const item = await getFileItem(file_id);
    if (item == null) {
      return 0;
    }
    const next = (valueNumber(item.deletionAttempts) ?? 0) + 1;
    await putRawItem({ ...item, deletionAttempts: next });
    return next;
  };

  /** `$max`-equivalent: a deferral can only ever move later, guarded with a
   *  ConditionExpression so a concurrent sweeper's shorter backoff can't pull
   *  the deadline forward past one already committed. */
  const deferExpiredFile = async (file_id: string, deletionRetryAt: Date): Promise<void> => {
    const item = await getFileItem(file_id);
    if (item == null) {
      return;
    }
    const nextIso = deletionRetryAt.toISOString();
    try {
      await client.send(
        new PutCommand({
          TableName,
          Item: toStoredItem({ ...item, deletionRetryAt: nextIso }),
          ConditionExpression: 'attribute_not_exists(deletionRetryAt) OR deletionRetryAt < :next',
          ExpressionAttributeValues: { ':next': nextIso },
        }),
      );
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
    }
  };

  const getToolFilesByIds = async (
    fileIds: string[],
    toolResourceSet?: Set<EToolResources>,
    ownerScope?: DynamoFileOwnerScope,
  ): Promise<DynamoItem[]> => {
    if (!fileIds?.length || !toolResourceSet?.size) {
      return [];
    }
    const orConditions: FileFilter[] = [];
    if (toolResourceSet.has(EToolResources.context)) {
      orConditions.push({ text: { $exists: true, $ne: null }, context: FileContext.agents });
    }
    if (toolResourceSet.has(EToolResources.file_search)) {
      orConditions.push({ embedded: true });
    }
    if (orConditions.length === 0) {
      return [];
    }
    const items = (await batchGetFiles(fileIds)).map(hydrateFile);
    const filtered = items.filter((item) => {
      if (item.context === FileContext.execute_code) {
        return false;
      }
      if (ownerScope?.userId != null && item.user !== ownerScope.userId) {
        return false;
      }
      if (ownerScope?.tenantId != null && item.tenantId !== ownerScope.tenantId) {
        return false;
      }
      return orConditions.some((condition) => matchesQuery(item, condition));
    });
    const sorted = [...filtered].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    return sorted.map((item) => project(item, '-text') ?? item);
  };

  const getCodeGeneratedFiles = async (
    conversationId: string,
    threadFileIds?: string[],
    ownerScope?: DynamoFileOwnerScope,
  ): Promise<DynamoItem[]> => {
    if (!conversationId || !threadFileIds?.length) {
      return [];
    }
    const items = (await batchGetFiles(threadFileIds)).map(hydrateFile);
    const filtered = items.filter(
      (item) =>
        item.conversationId === conversationId &&
        item.context === FileContext.execute_code &&
        (ownerScope?.userId == null || item.user === ownerScope.userId) &&
        (ownerScope?.tenantId == null || item.tenantId === ownerScope.tenantId) &&
        (getPath(item, 'metadata.codeEnvRef') != null || getPath(item, 'metadata.codeEnvRefs') != null),
    );
    const sorted = [...filtered].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    return sorted.map((item) => project(item, '-text') ?? item);
  };

  const getUserCodeFiles = async (fileIds: string[], ownerScope: DynamoFileOwnerScope): Promise<DynamoItem[]> => {
    if (!fileIds?.length) {
      return [];
    }
    const items = (await batchGetFiles(fileIds)).map(hydrateFile);
    const filtered = items.filter(
      (item) =>
        item.context !== FileContext.execute_code &&
        item.user === ownerScope.userId &&
        (ownerScope.tenantId == null || item.tenantId === ownerScope.tenantId) &&
        (getPath(item, 'metadata.codeEnvRef') != null || getPath(item, 'metadata.codeEnvRefs') != null),
    );
    const sorted = [...filtered].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    return sorted.map((item) => project(item, '-text') ?? item);
  };

  const getDeferredProvisionFiles = async (
    fileIds: string[],
    ownerScope: DynamoFileOwnerScope,
    resources: {
      code?: boolean;
      search?: boolean;
      codeRouteKey?: string;
      searchNamespaces?: string[];
      hydrateProvisioned?: boolean;
    } = { code: true, search: true },
  ): Promise<DynamoItem[]> => {
    if (!fileIds?.length) {
      return [];
    }
    const hydrateEverything =
      resources.hydrateProvisioned === true && (resources.code === true || resources.search === true);

    const codeMissing = (item: DynamoItem): boolean => {
      const routeKey = resources.codeRouteKey ?? 'default';
      assertValidCodeEnvironmentRouteKey(routeKey);
      const codeEnvRefs = getPath(item, 'metadata.codeEnvRefs') as DynamoItem | undefined;
      const codeEnvRef = getPath(item, 'metadata.codeEnvRef') as DynamoItem | undefined;
      if (codeEnvRefs?.[routeKey] != null) {
        return false;
      }
      if (codeEnvRef != null && codeEnvRef.executionRouteKey === routeKey) {
        return false;
      }
      if (codeEnvRef != null && codeEnvRef.executionRouteKey == null && codeEnvRef.executionProfile === routeKey) {
        return false;
      }
      if (
        routeKey === 'default' &&
        codeEnvRef != null &&
        codeEnvRef.executionRouteKey == null &&
        (codeEnvRef.executionProfile == null || codeEnvRef.executionProfile === 'default')
      ) {
        return false;
      }
      return true;
    };

    const searchMissing = (item: DynamoItem): boolean => {
      const namespaces = resources.searchNamespaces ?? [];
      if (namespaces.length === 0) {
        return item.embedded !== true;
      }
      if (item.context !== FileContext.agents && item.embedded !== true) {
        return true;
      }
      const embeddedEntities = ((getPath(item, 'metadata.embeddedEntities') as string[] | undefined) ?? []) as string[];
      return item.context === FileContext.agents && namespaces.some((namespace) => !embeddedEntities.includes(namespace));
    };

    if (!hydrateEverything && !resources.code && !resources.search) {
      return [];
    }
    const items = (await batchGetFiles(fileIds)).map(hydrateFile);
    const filtered = items.filter((item) => {
      if (item.context === FileContext.execute_code) {
        return false;
      }
      if (item.user !== ownerScope.userId) {
        return false;
      }
      if (ownerScope.tenantId != null && item.tenantId !== ownerScope.tenantId) {
        return false;
      }
      if (hydrateEverything) {
        return true;
      }
      const missing: boolean[] = [];
      if (resources.code) {
        missing.push(codeMissing(item));
      }
      if (resources.search) {
        missing.push(searchMissing(item));
      }
      return missing.some(Boolean);
    });
    const sorted = [...filtered].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    return sorted.map((item) => project(item, '-text') ?? item);
  };

  /** Atomically claims a file_id for a code-execution output by (filename,
   *  conversationId, tenantId) via a locator item, so concurrent claimants for
   *  the same key converge on one record instead of creating duplicates. */
  const claimCodeFile = async (data: {
    filename: string;
    conversationId: string;
    file_id: string;
    user: string;
    tenantId?: string | null;
    sourceDispatchedAt?: number;
  }): Promise<DynamoItem> => {
    const locatorKey = codeFileLocatorKey(data.filename, data.conversationId, data.tenantId ?? null);
    const now = new Date().toISOString();
    const newItem: DynamoItem = {
      ...fileKey(data.file_id),
      _id: data.file_id,
      file_id: data.file_id,
      user: data.user,
      filename: data.filename,
      conversationId: data.conversationId,
      context: FileContext.execute_code,
      object: 'file',
      ...(data.tenantId ? { tenantId: data.tenantId } : {}),
      ...(data.sourceDispatchedAt != null ? { metadata: { sourceDispatchedAt: data.sourceDispatchedAt } } : {}),
      createdAt: now,
      updatedAt: now,
      GSI1PK: `USER#${data.user}`,
      GSI1SK: `FILE#${now}#${data.file_id}`,
    };
    try {
      await client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName,
                Item: { ...locatorKey, file_id: data.file_id },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            { Put: { TableName, Item: toStoredItem(newItem), ConditionExpression: 'attribute_not_exists(PK)' } },
          ],
        }),
      );
      return hydrateFile(newItem);
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const locator = await getRawItem(locatorKey);
      const existingFileId = locator == null ? undefined : valueString(locator.file_id);
      const existing = existingFileId == null ? null : await getFileItem(existingFileId);
      if (existing == null) {
        throw new Error(
          `[claimCodeFile] Failed to claim file "${data.filename}" for conversation ${data.conversationId}`,
        );
      }
      return hydrateFile(existing);
    }
  };

  /** Creates or fills in a file record. Mongoose's `findOneAndUpdate` casts a
   *  plain (non-`$`) update document into an implicit `$set`, so this is a
   *  merge onto any existing record, not a replace. */
  const createFile = async (data: DynamoItem, disableTTL?: boolean): Promise<DynamoItem | null> => {
    const file_id = valueString(data.file_id);
    if (file_id == null) {
      throw new TypeError('file_id is required');
    }
    const now = new Date().toISOString();
    const existingItem = await getFileItem(file_id);
    const existing = existingItem == null ? null : cleanItem(existingItem);
    const merged: DynamoItem = {
      ...(existing ?? {}),
      ...data,
      _id: file_id,
      file_id,
      createdAt: valueString(existing?.createdAt) ?? valueString(data.createdAt) ?? now,
      updatedAt: now,
    };
    if (disableTTL) {
      delete merged.expiresAt;
    } else {
      merged.expiresAt = Math.floor(Date.now() / 1000) + 3600;
    }
    return writeFileRecord(merged, file_id);
  };

  /** Partial update, conditional on `extraFilter` matching the current record
   *  when given (e.g. the deferred-preview render's `previewRevision` guard).
   *  Always clears the upload TTL, matching Mongoose's `$unset: { expiresAt }`. */
  const updateFile = async (
    data: DynamoItem & { file_id: string },
    extraFilter?: FileFilter,
  ): Promise<DynamoItem | null> => {
    const { file_id, ...update } = data;
    const existingItem = await getFileItem(file_id);
    if (existingItem == null) {
      return null;
    }
    const existing = cleanItem(existingItem);
    if (extraFilter != null && !matchesQuery(existing, extraFilter)) {
      return null;
    }
    const now = new Date().toISOString();
    const merged: DynamoItem = { ...existing, ...update, _id: file_id, file_id, updatedAt: now };
    delete merged.expiresAt;
    return writeFileRecord(merged, file_id);
  };

  /** Background outputs commit only while their dispatch still owns the claimed filename. */
  const commitCodeFile = async (data: DynamoItem & { file_id: string }, sourceDispatchedAt?: number): Promise<boolean> => {
    if (sourceDispatchedAt == null) {
      await createFile(data, true);
      return true;
    }
    const committed = await updateFile(data, {
      $or: [{ 'metadata.sourceDispatchedAt': { $exists: false } }, { 'metadata.sourceDispatchedAt': { $lte: sourceDispatchedAt } }],
    });
    return committed != null;
  };

  const updateFileCodeEnvRef = async (data: {
    file_id: string;
    routeKey: string;
    ref: DynamoItem;
    legacyRef?: DynamoItem;
  }): Promise<DynamoItem | null> => {
    assertValidCodeEnvironmentRouteKey(data.routeKey);
    const existingItem = await getFileItem(data.file_id);
    if (existingItem == null) {
      return null;
    }
    const existing = cleanItem(existingItem);
    const metadata = (existing.metadata as DynamoItem | undefined) ?? {};
    const codeEnvRefs = { ...((metadata.codeEnvRefs as DynamoItem | undefined) ?? {}), [data.routeKey]: data.ref };
    const nextMetadata: DynamoItem = { ...metadata, codeEnvRefs };
    if (data.legacyRef) {
      nextMetadata.codeEnvRef = data.legacyRef;
    }
    return updateFile({ file_id: data.file_id, metadata: nextMetadata });
  };

  /** Records that a file has been embedded into one vector namespace, without
   *  disturbing namespaces already recorded — agents sharing a file record
   *  each need their own embedding. */
  const addFileEmbeddedEntity = async (data: { file_id: string; entityId: string }): Promise<DynamoItem | null> => {
    const existingItem = await getFileItem(data.file_id);
    if (existingItem == null) {
      return null;
    }
    const existing = cleanItem(existingItem);
    const metadata = (existing.metadata as DynamoItem | undefined) ?? {};
    const entities = new Set(((metadata.embeddedEntities as string[] | undefined) ?? []));
    entities.add(data.entityId);
    return updateFile({
      file_id: data.file_id,
      embedded: true,
      metadata: { ...metadata, embeddedEntities: [...entities] },
    });
  };

  /** Owner scoping is fail-closed: a mismatch leaves usage and TTL metadata unchanged. */
  const updateFileUsage = async (data: {
    file_id: string;
    inc?: number;
    user?: string;
    tenantId?: string | null;
  }): Promise<DynamoItem | null> => {
    const existingItem = await getFileItem(data.file_id);
    if (existingItem == null) {
      return null;
    }
    const existing = cleanItem(existingItem);
    if (data.user != null && existing.user !== data.user) {
      return null;
    }
    if (data.user != null && data.tenantId != null && existing.tenantId !== data.tenantId) {
      return null;
    }
    const now = new Date().toISOString();
    const merged: DynamoItem = {
      ...existing,
      _id: data.file_id,
      file_id: data.file_id,
      usage: (valueNumber(existing.usage) ?? 0) + (data.inc ?? 1),
      updatedAt: now,
    };
    delete merged.expiresAt;
    delete merged.temp_file_id;
    return writeFileRecord(merged, data.file_id);
  };

  const deleteFile = async (file_id: string): Promise<DynamoItem | null> => {
    const existingItem = await getFileItem(file_id);
    if (existingItem == null) {
      return null;
    }
    const existing = cleanItem(existingItem);
    const hasCodeLocator =
      existing.context === FileContext.execute_code &&
      typeof existing.filename === 'string' &&
      typeof existing.conversationId === 'string';
    await client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName, Key: fileKey(file_id) } },
          ...(hasCodeLocator
            ? [
                {
                  Delete: {
                    TableName,
                    Key: codeFileLocatorKey(
                      existing.filename as string,
                      existing.conversationId as string,
                      (existing.tenantId as string | undefined) ?? null,
                    ),
                  },
                },
              ]
            : []),
        ],
      }),
    );
    return hydrateFile(existingItem);
  };

  const deleteFileByFilter = async (filter: FileFilter): Promise<DynamoItem | null> => {
    const file_id =
      typeof filter.file_id === 'string' ? filter.file_id : typeof filter._id === 'string' ? filter._id : undefined;
    if (file_id != null) {
      return deleteFile(file_id);
    }
    if (typeof filter.user !== 'string') {
      throw new Error('Unsupported file filter shape for DynamoDB');
    }
    const { user: _user, ...rest } = filter;
    const candidates = (await queryOwnerFiles(filter.user)).map(hydrateFile);
    const match = candidates.find((item) => matchesQuery(item, rest));
    return match == null ? null : deleteFile(valueString(match.file_id) as string);
  };

  /** Faithful port of a pre-existing Mongoose oddity in `methods/file.ts`: when
   *  `user` is given, the query becomes `{ user }` and `file_ids` is ignored
   *  entirely, deleting every file that user owns. Not fixed here — see the
   *  migration plan's note on this being a pre-existing behavior. */
  const deleteFiles = async (file_ids: string[], user?: string): Promise<{ deletedCount?: number }> => {
    const targets = user ? await queryOwnerFiles(user) : await batchGetFiles(file_ids);
    const requests = targets.map((item) => ({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } }));
    for (let offset = 0; offset < requests.length; offset += 24) {
      let pending = requests.slice(offset, offset + 24);
      while (pending.length > 0) {
        const result = await client.send(new BatchWriteCommand({ RequestItems: { [TableName]: pending } }));
        pending = (result.UnprocessedItems?.[TableName] ?? []) as typeof pending;
      }
    }
    return { deletedCount: targets.length };
  };

  /** Batch refresh of signed-URL fields after a storage-key rotation. Does
   *  not clear `expiresAt`, matching the original bulk `$set`-only update. */
  const batchUpdateFiles = async (
    updates: Array<{ file_id: string; filepath: string; storageKey?: string; storageRegion?: string }>,
  ): Promise<void> => {
    if (!updates?.length) {
      return;
    }
    await Promise.all(
      updates.map(async (update) => {
        const existingItem = await getFileItem(update.file_id);
        if (existingItem == null) {
          return;
        }
        const existing = cleanItem(existingItem);
        const now = new Date().toISOString();
        const merged: DynamoItem = {
          ...existing,
          _id: update.file_id,
          file_id: update.file_id,
          filepath: update.filepath,
          ...(update.storageKey ? { storageKey: update.storageKey } : {}),
          ...(update.storageRegion ? { storageRegion: update.storageRegion } : {}),
          updatedAt: now,
        };
        await writeFileRecord(merged, update.file_id);
      }),
    );
  };

  const updateFilesUsage = async (
    files: Array<{ file_id: string }>,
    fileIds?: string[],
    options?: { user?: string; tenantId?: string | null },
  ): Promise<DynamoItem[]> => {
    const seen = new Set<string>();
    const promises: Promise<DynamoItem | null>[] = [];
    const push = (file_id: string) => {
      if (seen.has(file_id)) {
        return;
      }
      seen.add(file_id);
      promises.push(updateFileUsage({ file_id, user: options?.user, tenantId: options?.tenantId }));
    };
    files.forEach((file) => push(file.file_id));
    (fileIds ?? []).forEach(push);
    const results = await Promise.all(promises);
    return results.filter((result): result is DynamoItem => result != null);
  };

  /** Widens the upload-window TTL of owned, still-temporary files to
   *  `min(now + renewMs, createdAt + maxLifetimeMs)` — see `extendFilesTTL` in
   *  `methods/file.ts` for the full rationale this ports faithfully. */
  const extendFilesTTL = async (
    fileIds: string[],
    hold: { renewMs: number; maxLifetimeMs: number },
    owner: { user: string; tenantId?: string | null },
  ): Promise<number> => {
    const renewMs = hold?.renewMs;
    const maxLifetimeMs = hold?.maxLifetimeMs;
    if (!fileIds?.length || !owner?.user || !(renewMs > 0) || !(maxLifetimeMs > 0)) {
      return 0;
    }
    const items = (await batchGetFiles([...new Set(fileIds)])).map(hydrateFile);
    const renewUntil = Date.now() + renewMs;
    let widened = 0;
    await Promise.all(
      items.map(async (item) => {
        if (item.user !== owner.user) {
          return;
        }
        if (owner.tenantId != null && item.tenantId !== owner.tenantId) {
          return;
        }
        const createdAt = item.createdAt instanceof Date ? item.createdAt : undefined;
        const expiresAt = valueNumber(item.expiresAt);
        if (createdAt == null || expiresAt == null) {
          return;
        }
        const next = Math.min(renewUntil, createdAt.getTime() + maxLifetimeMs);
        if (expiresAt * 1000 >= next) {
          return;
        }
        const raw = await getFileItem(valueString(item.file_id) as string);
        if (raw == null) {
          return;
        }
        const nextEpochSeconds = Math.floor(next / 1000);
        try {
          await client.send(
            new PutCommand({
              TableName,
              Item: toStoredItem({ ...raw, expiresAt: nextEpochSeconds }),
              ConditionExpression: 'expiresAt < :next',
              ExpressionAttributeValues: { ':next': nextEpochSeconds },
            }),
          );
          widened += 1;
        } catch (error) {
          if (!isConditionalCheckFailed(error)) {
            throw error;
          }
        }
      }),
    );
    return widened;
  };

  /** Marks stale `status: 'pending'` records `'failed'` on boot, recovering
   *  from an in-process deferred-preview render lost to a backend restart.
   *  Cross-user by nature, so this is the one File method that scans. */
  const sweepOrphanedPreviews = async (maxAgeMs: number = 5 * 60 * 1000): Promise<number> => {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = await client.send(
      new ScanCommand({
        TableName,
        FilterExpression: 'begins_with(PK, :filePrefix) AND SK = :detail AND #status = :pending AND updatedAt < :cutoff',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':filePrefix': 'FILE#',
          ':detail': 'DETAIL',
          ':pending': 'pending',
          ':cutoff': cutoff,
        },
      }),
    );
    const items = (result.Items ?? []) as DynamoItem[];
    await Promise.all(items.map((item) => putRawItem({ ...item, status: 'failed', previewError: 'orphaned' })));
    return items.length;
  };

  const findRunArtifactFile = async (scope: {
    userId: string;
    tenantId?: string | null;
    conversationId: string;
    runId: string;
    executionId: string;
    agentId: string;
    sourceFileId: string;
  }): Promise<DynamoItem | null> => {
    const item = await getFileItem(runArtifactFileId(scope));
    if (item == null) {
      return null;
    }
    const file = hydrateFile(item);
    const runFile = getPath(file, 'metadata.runFile') as DynamoItem | undefined;
    if (runFile != null && runFile.agentId !== scope.agentId) {
      throw new Error('The run artifact belongs to a different producing agent');
    }
    return file;
  };

  const listRunArtifacts = async (scope: {
    userId: string;
    tenantId?: string | null;
    conversationId: string;
    runId: string;
  }): Promise<DynamoItem[]> => {
    const items = (await queryOwnerFiles(scope.userId)).map(hydrateFile);
    const filtered = items.filter(
      (item) =>
        item.conversationId === scope.conversationId &&
        item.context === FileContext.run_artifact &&
        getPath(item, 'metadata.runFile.runId') === scope.runId &&
        (scope.tenantId == null ? item.tenantId == null : item.tenantId === scope.tenantId),
    );
    return filtered.sort((a, b) => {
      const created = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
      return created !== 0 ? created : String(a.file_id ?? '').localeCompare(String(b.file_id ?? ''));
    });
  };

  const claimRunArtifactFile = async (scope: {
    userId: string;
    tenantId?: string | null;
    conversationId: string;
    runId: string;
    executionId: string;
    agentId: string;
    sourceFileId: string;
  }): Promise<{ file_id: string; file?: DynamoItem }> => {
    const file = await findRunArtifactFile(scope);
    return file == null ? { file_id: runArtifactFileId(scope) } : { file_id: valueString(file.file_id) as string, file };
  };

  /** Publishes one complete storage result, idempotently. The publication id
   *  is a deterministic hash of the full identity scope (see
   *  `runArtifactFileId`), so a conditional put on `attribute_not_exists(PK)`
   *  is enough to guarantee a retried writer cannot replace committed bytes —
   *  no separate uniqueness index is needed the way Mongo's compound index required. */
  const publishRunArtifactFile = async (input: {
    scope: {
      userId: string;
      tenantId?: string | null;
      conversationId: string;
      runId: string;
      executionId: string;
      agentId: string;
      sourceFileId: string;
    };
    file: DynamoItem;
    provenance: DynamoItem;
  }): Promise<DynamoItem> => {
    const { scope, file, provenance } = input;
    if (
      provenance.runId !== scope.runId ||
      provenance.executionId !== scope.executionId ||
      provenance.agentId !== scope.agentId ||
      provenance.sourceFileId !== scope.sourceFileId ||
      !Number.isFinite(Date.parse(valueString(provenance.publishedAt) ?? ''))
    ) {
      throw new Error('Run artifact provenance does not match its publication scope');
    }
    if (
      !file.filepath ||
      !file.filename ||
      !file.type ||
      file.source === FileSources.execute_code ||
      !Number.isSafeInteger(file.bytes) ||
      (file.bytes as number) < 0
    ) {
      throw new Error('A durable stored file is required to publish a run artifact');
    }
    const file_id = runArtifactFileId(scope);
    const now = new Date().toISOString();
    // A published run artifact is an immutable durable copy: it never carries the
    // source's code-environment or file-search vector references forward.
    const { codeEnvRef: _codeEnvRef, codeEnvRefs: _codeEnvRefs, embeddedEntities: _embeddedEntities, ...restMetadata } =
      (file.metadata as DynamoItem | undefined) ?? {};
    const optionalFields: DynamoItem = {};
    for (const key of [
      'storageKey',
      'storageRegion',
      'text',
      'textFormat',
      'status',
      'previewError',
      'previewRevision',
      'width',
      'height',
      'messageId',
    ]) {
      if (file[key] != null) {
        optionalFields[key] = file[key];
      }
    }
    if (file.expiredAt != null) {
      optionalFields.expiredAt = file.expiredAt instanceof Date ? file.expiredAt.toISOString() : file.expiredAt;
    }
    const item: DynamoItem = {
      ...fileKey(file_id),
      _id: file_id,
      file_id,
      user: scope.userId,
      ...(scope.tenantId != null ? { tenantId: scope.tenantId } : {}),
      conversationId: scope.conversationId,
      context: FileContext.run_artifact,
      object: 'file',
      filename: file.filename,
      filepath: file.filepath,
      bytes: file.bytes,
      type: file.type,
      source: file.source ?? FileSources.local,
      embedded: false,
      usage: 1,
      llmDeliveryPath: file.llmDeliveryPath ?? 'none',
      ...optionalFields,
      metadata: { ...restMetadata, destinationChosen: false, runFile: provenance },
      createdAt: now,
      updatedAt: now,
      GSI1PK: `USER#${scope.userId}`,
      GSI1SK: `FILE#${now}#${file_id}`,
    };
    try {
      await client.send(
        new PutCommand({ TableName, Item: toStoredItem(item), ConditionExpression: 'attribute_not_exists(PK)' }),
      );
      return hydrateFile(item);
    } catch (error) {
      if (!isConditionalCheckFailed(error)) {
        throw error;
      }
      const existing = await findRunArtifactFile(scope);
      if (existing != null) {
        return existing;
      }
      throw error;
    }
  };

  /** Hydrates only host-selected IDs; the caller applies its existing agent-file authorization. */
  const getRunFileCandidates = async (fileIds: readonly string[], tenantId?: string | null): Promise<DynamoItem[]> => {
    if (fileIds.length === 0) {
      return [];
    }
    const items = (await batchGetFiles(fileIds)).map(hydrateFile);
    return items
      .filter((item) => (item.tenantId ?? null) === (tenantId ?? null))
      .map((item) => ({ ...item, embedded: item.embedded === true }));
  };

  return {
    findFileById,
    getFiles,
    getExpiredFiles,
    incrementFileDeletionAttempts,
    deferExpiredFile,
    getToolFilesByIds,
    getCodeGeneratedFiles,
    getUserCodeFiles,
    getDeferredProvisionFiles,
    claimCodeFile,
    commitCodeFile,
    createFile,
    updateFile,
    updateFileCodeEnvRef,
    addFileEmbeddedEntity,
    updateFileUsage,
    deleteFile,
    deleteFiles,
    deleteFileByFilter,
    batchUpdateFiles,
    updateFilesUsage,
    extendFilesTTL,
    sweepOrphanedPreviews,
    getRunFileCandidates,
    claimRunArtifactFile,
    publishRunArtifactFile,
    findRunArtifactFile,
    listRunArtifacts,
  };
}
