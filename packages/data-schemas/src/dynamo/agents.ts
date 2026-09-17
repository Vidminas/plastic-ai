import { randomBytes } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { assertItemSize, cleanItem, DEFAULT_DYNAMO_TABLE, project, valueString } from './core';
import type { DynamoCoreConfig, DynamoItem, DynamoValue } from './core';
import { createDynamoAclMethods } from './acl';

/** Mongo-ObjectId-shaped (24 hex chars), matching `dynamo/core.ts`'s `id()` —
 *  needed because `_id` is a distinct field from the human-readable `id` an
 *  agent already carries, and code elsewhere (e.g. `PermissionService`'s ACL
 *  grants, keyed off `agent._id`) validates it as Mongo-ObjectId-shaped. */
const objectId = (): string => randomBytes(12).toString('hex');

/**
 * Minimal DynamoDB port of the Agent entity — `getAgent`, `updateAgent`,
 * `deleteAgent`, `addAgentResourceFile`, and a bare-bones `createAgent` (just
 * enough for the agent builder UI to persist a new agent to test against).
 * The rest of the Mongoose Agent method surface (a generic multi-filter
 * `getAgents`, `duplicateAgent`, the skill-allowlist self-heal and
 * code-environment-reference handling in the full `createAgent`/
 * `updateAgent`, graph/action management) is NOT ported here — that is full
 * Agent CRUD, a separate and much larger migration than file persistence.
 */

const toStoredItem = (item: DynamoItem): DynamoItem => JSON.parse(JSON.stringify(item)) as DynamoItem;

const agentKey = (id: string): DynamoItem => ({ PK: `AGENT#${id}`, SK: 'DETAIL' });

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

const getDeep = (item: DynamoItem, path: string): DynamoValue | undefined =>
  path.split('.').reduce<DynamoValue | undefined>((acc, key) => {
    if (acc == null || typeof acc !== 'object' || Array.isArray(acc) || acc instanceof Date) {
      return undefined;
    }
    return (acc as DynamoItem)[key];
  }, item);

const setDeep = (item: DynamoItem, path: string, value: DynamoValue): DynamoItem => {
  const keys = path.split('.');
  const clone: DynamoItem = { ...item };
  let cursor = clone;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = cursor[key];
    const nextObj: DynamoItem =
      next != null && typeof next === 'object' && !Array.isArray(next) && !(next instanceof Date)
        ? { ...(next as DynamoItem) }
        : {};
    cursor[key] = nextObj;
    cursor = nextObj;
  }
  cursor[keys[keys.length - 1]] = value;
  return clone;
};

const deleteDeep = (item: DynamoItem, path: string): DynamoItem => {
  const keys = path.split('.');
  const clone: DynamoItem = { ...item };
  let cursor = clone;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const next = cursor[key];
    if (next == null || typeof next !== 'object' || Array.isArray(next) || next instanceof Date) {
      return clone;
    }
    const nextObj: DynamoItem = { ...(next as DynamoItem) };
    cursor[key] = nextObj;
    cursor = nextObj;
  }
  delete cursor[keys[keys.length - 1]];
  return clone;
};

const sameValue = (a: DynamoValue, b: DynamoValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Applies the `$addToSet` / `$push` / `$pull` / `$unset` / direct-field
 *  update shapes Mongoose `FilterQuery` updates commonly use, against a
 *  plain object — the operators `addAgentResourceFile` actually issues.
 *  Does not snapshot a `versions` entry the way the full Mongoose
 *  `updateAgent` does. */
const applyUpdateOperators = (item: DynamoItem, updateData: DynamoItem): DynamoItem => {
  const { $addToSet, $push, $pull, $unset, ...direct } = updateData;
  let next = item;
  for (const [path, value] of Object.entries(direct)) {
    next = setDeep(next, path, value as DynamoValue);
  }
  if ($addToSet != null && typeof $addToSet === 'object') {
    for (const [path, raw] of Object.entries($addToSet as DynamoItem)) {
      const current = getDeep(next, path);
      const array = Array.isArray(current) ? [...current] : [];
      const additions =
        raw != null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as DynamoItem).$each)
          ? ((raw as DynamoItem).$each as DynamoValue[])
          : [raw as DynamoValue];
      for (const addition of additions) {
        if (!array.some((existing) => sameValue(existing, addition))) {
          array.push(addition);
        }
      }
      next = setDeep(next, path, array);
    }
  }
  if ($push != null && typeof $push === 'object') {
    for (const [path, value] of Object.entries($push as DynamoItem)) {
      const current = getDeep(next, path);
      const array = Array.isArray(current) ? [...current] : [];
      array.push(value as DynamoValue);
      next = setDeep(next, path, array);
    }
  }
  if ($pull != null && typeof $pull === 'object') {
    for (const [path, value] of Object.entries($pull as DynamoItem)) {
      const current = getDeep(next, path);
      if (Array.isArray(current)) {
        next = setDeep(next, path, current.filter((entry) => !sameValue(entry, value as DynamoValue)));
      }
    }
  }
  if ($unset != null && typeof $unset === 'object') {
    for (const path of Object.keys($unset as DynamoItem)) {
      next = deleteDeep(next, path);
    }
  }
  return next;
};

/** `isolatedDeclarations` requires an exported factory's return type to be
 *  statically inferable without cross-file analysis — see `DynamoFileMethods`
 *  in `dynamo/files.ts` for the same requirement. */
export interface DynamoAgentMethods {
  createAgent: (agentData: DynamoItem) => Promise<DynamoItem>;
  getAgent: (searchParameter: DynamoItem, projection?: string | DynamoItem | null) => Promise<DynamoItem | null>;
  getAgentWithVersionCount: (searchParameter: DynamoItem) => Promise<DynamoItem | null>;
  getAgentVersions: (searchParameter: DynamoItem) => Promise<DynamoItem[] | null>;
  updateAgent: (
    searchParameter: DynamoItem,
    updateData: DynamoItem,
    options?: { updatingUserId?: string | null; forceVersion?: boolean; skipVersioning?: boolean },
  ) => Promise<DynamoItem | null>;
  addAgentResourceFile: (data: {
    agent_id: string;
    tool_resource: string;
    file_id: string;
    updatingUserId?: string;
  }) => Promise<DynamoItem>;
  deleteAgent: (searchParameter: DynamoItem) => Promise<DynamoItem | null>;
  getListAgentsByAccess: (params: {
    accessibleIds?: string[];
    otherParams?: DynamoItem;
    limit?: number | null;
    after?: string | null;
  }) => Promise<{
    object: string;
    data: DynamoItem[];
    first_id: string | null;
    last_id: string | null;
    has_more: boolean;
    after: string | null;
  }>;
  /** Marketplace category list. Always empty: nothing in this minimal port
   *  ever marks an agent as categorized/promoted, and `share`/`public` stay
   *  disabled in `librechat.yaml` regardless. */
  getCategoriesWithCounts: () => Promise<DynamoItem[]>;
  countPromotedAgents: () => Promise<number>;
  removeAgentResourceFiles: (params: {
    agent_id: string;
    files: Array<{ tool_resource: string; file_id: string }>;
  }) => Promise<DynamoItem>;
  removeAgentResourceFilesFromAllAgents: (params: {
    file_ids: string[];
  }) => Promise<{ matchedCount: number; modifiedCount: number }>;
}

export function createDynamoAgentMethods(
  client: DynamoDBDocumentClient,
  config: DynamoCoreConfig = {},
): DynamoAgentMethods {
  const TableName = config.tableName ?? DEFAULT_DYNAMO_TABLE;
  const acl = createDynamoAclMethods(client, config);

  const getRawItem = async (key: DynamoItem): Promise<DynamoItem | null> => {
    const result = await client.send(new GetCommand({ TableName, Key: key, ConsistentRead: true }));
    return result.Item == null ? null : (result.Item as DynamoItem);
  };

  const putRawItem = async (item: DynamoItem): Promise<void> => {
    const stored = toStoredItem(item);
    assertItemSize(stored);
    await client.send(new PutCommand({ TableName, Item: stored }));
  };

  /** Bare-bones create: persists `agentData` as given under its `id`, plus a
   *  single-entry `versions` snapshot mirroring the full Mongoose `createAgent`'s
   *  shape. Skips skill-allowlist pruning against the skill registry and
   *  code-environment-reference provisioning — both orthogonal to getting an
   *  agent record to exist at all. */
  const createAgent = async (agentData: DynamoItem): Promise<DynamoItem> => {
    const id = valueString(agentData.id);
    if (id == null) {
      throw new TypeError('agent id is required');
    }
    const now = new Date().toISOString();
    const { author: _author, ...versionData } = agentData;
    const item: DynamoItem = {
      ...agentKey(id),
      ...agentData,
      _id: objectId(),
      id,
      category: valueString(agentData.category) ?? 'general',
      versions: [{ ...versionData, createdAt: now, updatedAt: now }],
      createdAt: now,
      updatedAt: now,
      GSI1PK: `USER#${valueString(agentData.author) ?? ''}`,
      GSI1SK: `AGENT#${now}#${id}`,
    };
    await client.send(
      new PutCommand({ TableName, Item: toStoredItem(item), ConditionExpression: 'attribute_not_exists(PK)' }),
    );
    return cleanItem(item);
  };

  /** Only `{ id: agentId }` is supported — the one shape `addAgentResourceFile` uses. */
  const getAgent = async (
    searchParameter: DynamoItem,
    projection?: string | DynamoItem | null,
  ): Promise<DynamoItem | null> => {
    const agentId = valueString(searchParameter.id);
    if (agentId == null) {
      throw new Error('Unsupported agent filter shape for DynamoDB');
    }
    const item = await getRawItem(agentKey(agentId));
    return item == null ? null : project(cleanItem(item), normalizeSelect(projection));
  };

  /** Applies `updateData`'s update operators to the existing agent and writes
   *  it back. No upsert (mirrors the Mongoose call's `upsert: false`), no
   *  version snapshot — see the module doc comment. */
  const updateAgent = async (
    searchParameter: DynamoItem,
    updateData: DynamoItem,
    _options: { updatingUserId?: string | null; forceVersion?: boolean; skipVersioning?: boolean } = {},
  ): Promise<DynamoItem | null> => {
    const agentId = valueString(searchParameter.id);
    if (agentId == null) {
      throw new Error('Unsupported agent filter shape for DynamoDB');
    }
    const existingItem = await getRawItem(agentKey(agentId));
    if (existingItem == null) {
      return null;
    }
    const existing = cleanItem(existingItem);
    const applied = applyUpdateOperators(existing, updateData);
    const now = new Date().toISOString();
    // `_id` is left as whatever `applied` already carries forward from the
    // existing item (set once, at creation, by `createAgent`) — it must not
    // be reset to `agentId`, which is the human-readable `id`, not the
    // Mongo-ObjectId-shaped `_id` ACL grants are keyed on.
    const merged: DynamoItem = { ...applied, id: agentId, updatedAt: now };
    const item: DynamoItem = {
      ...agentKey(agentId),
      ...merged,
      GSI1PK: `USER#${valueString(merged.author) ?? ''}`,
      GSI1SK: `AGENT#${now}#${agentId}`,
    };
    await putRawItem(item);
    return cleanItem(item);
  };

  /** Same record as `getAgent`, with a derived `version` count in place of
   *  the (potentially large) `versions` array — mirrors the Mongoose
   *  aggregation's `$addFields: {version: {$size: ...}}, $project: {versions: 0}`. */
  const getAgentWithVersionCount = async (searchParameter: DynamoItem): Promise<DynamoItem | null> => {
    const agent = await getAgent(searchParameter);
    if (agent == null) {
      return null;
    }
    const { versions, ...rest } = agent;
    return { ...rest, version: Array.isArray(versions) ? versions.length : 0 };
  };

  /** Version history only, without the rest of the document — mirrors the
   *  Mongoose method's "empty array if versionless, null if agent missing" contract. */
  const getAgentVersions = async (searchParameter: DynamoItem): Promise<DynamoItem[] | null> => {
    const agent = await getAgent(searchParameter);
    if (agent == null) {
      return null;
    }
    return Array.isArray(agent.versions) ? (agent.versions as DynamoItem[]) : [];
  };

  /** Scans for agent items rather than indexing by `_id`, since `accessibleIds`
   *  (from the ACL layer's `findAccessibleResources`) are Mongo-ObjectId-shaped
   *  `_id` values, not the `id` field the primary key is built from — there's
   *  no cheap index from one to the other. Acceptable at the scale a single
   *  deployment's agent count reaches; the real Mongoose method also has no
   *  equivalent secondary index and relies on `_id` being the native key.
   *  `includeSkillConfig`/`includeExecutionConfig` are accepted but ignored —
   *  this always returns full records rather than field-trimming for those flags. */
  const getListAgentsByAccess = async (params: {
    accessibleIds?: string[];
    otherParams?: DynamoItem;
    limit?: number | null;
    after?: string | null;
  }): Promise<{
    object: string;
    data: DynamoItem[];
    first_id: string | null;
    last_id: string | null;
    has_more: boolean;
    after: string | null;
  }> => {
    const accessible = new Set(params.accessibleIds ?? []);
    if (accessible.size === 0) {
      return { object: 'list', data: [], first_id: null, last_id: null, has_more: false, after: null };
    }
    const result = await client.send(
      new ScanCommand({
        TableName,
        FilterExpression: 'begins_with(PK, :agentPrefix) AND SK = :detail',
        ExpressionAttributeValues: { ':agentPrefix': 'AGENT#', ':detail': 'DETAIL' },
      }),
    );
    const otherParams = params.otherParams ?? {};
    const items = ((result.Items ?? []) as DynamoItem[])
      .map(cleanItem)
      .filter((item) => {
        const agentId = valueString(item._id);
        if (agentId == null || !accessible.has(agentId)) {
          return false;
        }
        return Object.entries(otherParams).every(([path, expected]) => getDeep(item, path) === expected);
      })
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    const limit = params.limit ?? 25;
    const offset = params.after == null ? 0 : Number.parseInt(params.after, 10) || 0;
    const page = items.slice(offset, offset + limit);
    return {
      object: 'list',
      data: page,
      first_id: page.length > 0 ? valueString(page[0].id) ?? null : null,
      last_id: page.length > 0 ? valueString(page[page.length - 1].id) ?? null : null,
      has_more: offset + limit < items.length,
      after: offset + limit < items.length ? String(offset + limit) : null,
    };
  };

  /** Records that a file belongs to an agent's tool resource, adding the tool
   *  to `tools` and the file to `tool_resources.<tool_resource>.file_ids`
   *  without disturbing whatever else is already there. */
  const addAgentResourceFile = async (data: {
    agent_id: string;
    tool_resource: string;
    file_id: string;
    updatingUserId?: string;
  }): Promise<DynamoItem> => {
    const searchParameter = { id: data.agent_id };
    const agent = await getAgent(searchParameter);
    if (!agent) {
      throw new Error('Agent not found for adding resource file');
    }
    const fileIdsPath = `tool_resources.${data.tool_resource}.file_ids`;
    const updated = await updateAgent(
      searchParameter,
      { $addToSet: { tools: data.tool_resource, [fileIdsPath]: data.file_id } },
      { updatingUserId: data.updatingUserId },
    );
    if (updated == null) {
      throw new Error('Agent not found for adding resource file');
    }
    return updated;
  };

  /** Deletes the agent item and sweeps its ACL grants (both `agent` and
   *  `remoteAgent` resource types, matching the pair `createAgent`'s route
   *  handler grants on creation) so no stale grant is left pointing at a
   *  deleted resource. */
  const deleteAgent = async (searchParameter: DynamoItem): Promise<DynamoItem | null> => {
    const agentId = valueString(searchParameter.id);
    if (agentId == null) {
      throw new Error('Unsupported agent filter shape for DynamoDB');
    }
    const existingItem = await getRawItem(agentKey(agentId));
    if (existingItem == null) {
      return null;
    }
    const existing = cleanItem(existingItem);
    await client.send(new DeleteCommand({ TableName, Key: agentKey(agentId) }));
    const resourceId = valueString(existing._id) ?? agentId;
    await Promise.all([
      acl.deleteAclEntries({ resourceType: 'agent', resourceId }),
      acl.deleteAclEntries({ resourceType: 'remoteAgent', resourceId }),
    ]);
    return existing;
  };

  const getCategoriesWithCounts = async (): Promise<DynamoItem[]> => [];
  const countPromotedAgents = async (): Promise<number> => 0;

  const writeAgentItem = async (agentId: string, next: DynamoItem): Promise<DynamoItem> => {
    const now = new Date().toISOString();
    const merged: DynamoItem = { ...next, id: agentId, updatedAt: now };
    const item: DynamoItem = {
      ...agentKey(agentId),
      ...merged,
      GSI1PK: `USER#${valueString(merged.author) ?? ''}`,
      GSI1SK: `AGENT#${now}#${agentId}`,
    };
    await putRawItem(item);
    return cleanItem(item);
  };

  /** `$pullAll`-equivalent: removes specific file_ids from specific
   *  `tool_resources.<resource>.file_ids` arrays, grouped by resource. */
  const removeAgentResourceFiles = async (params: {
    agent_id: string;
    files: Array<{ tool_resource: string; file_id: string }>;
  }): Promise<DynamoItem> => {
    const existingItem = await getRawItem(agentKey(params.agent_id));
    if (existingItem == null) {
      throw new Error('Agent not found for removing resource files');
    }
    const byResource = new Map<string, Set<string>>();
    for (const { tool_resource, file_id } of params.files) {
      if (!byResource.has(tool_resource)) {
        byResource.set(tool_resource, new Set());
      }
      byResource.get(tool_resource)?.add(file_id);
    }
    let next = cleanItem(existingItem);
    for (const [resource, ids] of byResource) {
      const path = `tool_resources.${resource}.file_ids`;
      const current = getDeep(next, path);
      if (Array.isArray(current)) {
        next = setDeep(next, path, current.filter((value) => !ids.has(value as string)));
      }
    }
    return writeAgentItem(params.agent_id, next);
  };

  /** Sweeps every agent for the given `file_ids` across all tool-resource
   *  file-id arrays, cross-user by nature (a deleted file may belong to any
   *  agent), so — like `sweepOrphanedPreviews` in `dynamo/files.ts` — this
   *  is the one agent method that scans. */
  const removeAgentResourceFilesFromAllAgents = async (params: {
    file_ids: string[];
  }): Promise<{ matchedCount: number; modifiedCount: number }> => {
    if (!params.file_ids?.length) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const idSet = new Set(params.file_ids);
    const result = await client.send(
      new ScanCommand({
        TableName,
        FilterExpression: 'begins_with(PK, :agentPrefix) AND SK = :detail',
        ExpressionAttributeValues: { ':agentPrefix': 'AGENT#', ':detail': 'DETAIL' },
      }),
    );
    const items = ((result.Items ?? []) as DynamoItem[]).map(cleanItem);
    let matchedCount = 0;
    let modifiedCount = 0;
    await Promise.all(
      items.map(async (item) => {
        const toolResources = item.tool_resources as DynamoItem | undefined;
        const agentId = valueString(item.id);
        if (toolResources == null || agentId == null) {
          return;
        }
        let next = item;
        let changed = false;
        for (const resource of Object.keys(toolResources)) {
          const path = `tool_resources.${resource}.file_ids`;
          const current = getDeep(next, path);
          if (Array.isArray(current) && current.some((value) => idSet.has(value as string))) {
            matchedCount += 1;
            changed = true;
            next = setDeep(next, path, current.filter((value) => !idSet.has(value as string)));
          }
        }
        if (changed) {
          modifiedCount += 1;
          await writeAgentItem(agentId, next);
        }
      }),
    );
    return { matchedCount, modifiedCount };
  };

  return {
    createAgent,
    getAgent,
    getAgentWithVersionCount,
    getAgentVersions,
    updateAgent,
    addAgentResourceFile,
    deleteAgent,
    getListAgentsByAccess,
    getCategoriesWithCounts,
    countPromotedAgents,
    removeAgentResourceFiles,
    removeAgentResourceFilesFromAllAgents,
  };
}
