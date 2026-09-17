import { accessRoleToPermBits } from 'librechat-data-provider';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_DYNAMO_TABLE, valueNumber, valueString } from './core';
import type { DynamoCoreConfig, DynamoItem } from './core';

/**
 * Minimal DynamoDB port of the ACL/permission-grant system
 * (`api/server/services/PermissionService.js`, backed by the Mongoose
 * `AclEntry`/`AccessRole`/`Group` collections). Scoped to exactly what
 * `POST /api/agents` needs to grant its creator OWNER access and have that
 * grant read back by `canAccessResource`: single-principal (`user`) grants
 * only. NOT ported: GROUP/ROLE/PUBLIC principals, group sync
 * (`findGroupById`/`createGroup`/etc.), `bulkWriteAclEntries`,
 * `invalidatePromptGroupAccessContext` (PROMPTGROUP-specific,
 * never reached by AGENT/REMOTE_AGENT grants). `findPublicResourceIds`/
 * `findEntriesByPrincipalsAndResource` always answer empty — nothing in this
 * minimal scope ever writes a PUBLIC-principal grant.
 *
 * Role resolution (`findRoleByIdentifier`/`findRolesByResourceType`) uses a
 * static in-code table via `accessRoleToPermBits` (already exported from
 * `librechat-data-provider`) instead of reading `AccessRole` documents —
 * this is not a downgrade: the real Mongoose deployment never runs
 * `seedDefaultRoles()` in production either (`api/models/index.js` has it
 * commented out), so `AccessRole` documents aren't guaranteed to exist there
 * either. A static table is strictly more reliable.
 */

const aclKey = (resourceType: string, resourceId: string, principalId: string): DynamoItem => ({
  PK: `RESOURCE#${resourceType}#${resourceId}`,
  SK: `PRINCIPAL#user#${principalId}`,
});

const toStoredItem = (item: DynamoItem): DynamoItem => JSON.parse(JSON.stringify(item)) as DynamoItem;

/** `accessRoleId`s follow `<resourceType>_<viewer|editor|owner|manager>`, and
 *  `ResourceType` enum values (`agent`, `remoteAgent`, ...) are exactly that
 *  prefix, so the role never needs to be read from storage. */
const deriveRole = (accessRoleId: string): { accessRoleId: string; resourceType: string; permBits: number } => {
  const separator = accessRoleId.lastIndexOf('_');
  const resourceType = separator === -1 ? accessRoleId : accessRoleId.slice(0, separator);
  return { accessRoleId, resourceType, permBits: accessRoleToPermBits(accessRoleId) };
};

export interface DynamoAclMethods {
  findRoleByIdentifier: (accessRoleId: string) => Promise<DynamoItem>;
  findRolesByResourceType: (resourceType: string) => Promise<DynamoItem[]>;
  grantPermission: (
    principalType: string,
    principalId: string,
    resourceType: string,
    resourceId: string,
    permBits: number,
    grantedBy?: string,
    session?: unknown,
    roleId?: string,
  ) => Promise<DynamoItem>;
  getUserPrincipals: (params: {
    userId: string;
    role?: string;
    idOnTheSource?: string;
  }) => Promise<Array<{ principalType: string; principalId: string }>>;
  hasPermission: (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    resourceId: string,
    requiredPermission: number,
  ) => Promise<boolean>;
  getEffectivePermissions: (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    resourceId: string,
  ) => Promise<number>;
  getEffectivePermissionsForResources: (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    resourceIds: string[],
  ) => Promise<Map<string, number>>;
  findAccessibleResources: (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    requiredPermissions: number,
  ) => Promise<string[]>;
  findPublicResourceIds: (resourceType: string, requiredPermissions: number) => Promise<string[]>;
  /** `PermissionService.hasPublicPermission` calls this directly (not a
   *  `db.hasPublicPermission`) and does its own `permBits` matching over the
   *  result — always empty here since PUBLIC-principal grants are never
   *  written in this minimal scope. */
  findEntriesByPrincipalsAndResource: (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    resourceId: string,
  ) => Promise<DynamoItem[]>;
  /** Narrow, non-generic support for the one aggregation pipeline shape
   *  `api/server/services/Agents/ownerContact.js`'s `attachOwnerContacts`
   *  issues (`$match` on `resourceType`/`resourceId.$in`/`principalType`/
   *  `permBits`, then `$group` first-by-`grantedAt`) — used to resolve each
   *  listed agent's owner for the "Agents" list view. Throws on any other
   *  pipeline shape, e.g. the fuller one `PermissionsController.js` issues
   *  for the resource-sharing UI, which stays out of this minimal scope
   *  (`share`/`public` are disabled in `librechat.yaml` regardless). */
  aggregateAclEntries: (pipeline: unknown[]) => Promise<DynamoItem[]>;
  /** Removes every grant for one resource — called by `PermissionService`'s
   *  `removeAllPermissions` (resource-deletion cleanup, e.g. `deleteAgent`). */
  deleteAclEntries: (params: { resourceType: string; resourceId: string }) => Promise<{ deletedCount: number }>;
}

export function createDynamoAclMethods(
  client: DynamoDBDocumentClient,
  config: DynamoCoreConfig = {},
): DynamoAclMethods {
  const TableName = config.tableName ?? DEFAULT_DYNAMO_TABLE;

  const getEntry = async (
    resourceType: string,
    resourceId: string,
    principalId: string,
  ): Promise<DynamoItem | null> => {
    const result = await client.send(
      new GetCommand({ TableName, Key: aclKey(resourceType, resourceId, principalId), ConsistentRead: true }),
    );
    return result.Item == null ? null : (result.Item as DynamoItem);
  };

  /** Only `user`-type principals are ever looked up — GROUP/ROLE/PUBLIC
   *  grants are never written in this minimal scope, so checking them would
   *  only ever find nothing. */
  const userPrincipalIds = (principals: Array<{ principalType: string; principalId: string }>): string[] =>
    principals.filter((p) => p.principalType === 'user').map((p) => p.principalId).filter(Boolean);

  const findRoleByIdentifier = async (accessRoleId: string): Promise<DynamoItem> => deriveRole(accessRoleId);

  const findRolesByResourceType = async (resourceType: string): Promise<DynamoItem[]> =>
    (['viewer', 'editor', 'owner'] as const)
      .map((suffix) => deriveRole(`${resourceType}_${suffix}`))
      .filter((role) => role.permBits > 0);

  const grantPermission = async (
    principalType: string,
    principalId: string,
    resourceType: string,
    resourceId: string,
    permBits: number,
    grantedBy?: string,
    _session?: unknown,
    roleId?: string,
  ): Promise<DynamoItem> => {
    const now = new Date().toISOString();
    const item: DynamoItem = {
      ...aclKey(resourceType, resourceId, principalId),
      principalType,
      principalId,
      resourceType,
      resourceId,
      permBits,
      ...(roleId != null ? { roleId } : {}),
      ...(grantedBy != null ? { grantedBy } : {}),
      grantedAt: now,
      GSI1PK: `PRINCIPAL#${principalType}#${principalId}`,
      GSI1SK: `RESOURCE#${resourceType}#${resourceId}`,
    };
    await client.send(new PutCommand({ TableName, Item: toStoredItem(item) }));
    return item;
  };

  const getUserPrincipals = async (params: {
    userId: string;
  }): Promise<Array<{ principalType: string; principalId: string }>> => [
    { principalType: 'user', principalId: params.userId },
  ];

  const hasPermission = async (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    resourceId: string,
    requiredPermission: number,
  ): Promise<boolean> => {
    for (const principalId of userPrincipalIds(principals)) {
      const entry = await getEntry(resourceType, resourceId, principalId);
      const bits = entry == null ? 0 : (valueNumber(entry.permBits) ?? 0);
      if ((bits & requiredPermission) === requiredPermission) {
        return true;
      }
    }
    return false;
  };

  const getEffectivePermissions = async (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    resourceId: string,
  ): Promise<number> => {
    const entries = await Promise.all(
      userPrincipalIds(principals).map((principalId) => getEntry(resourceType, resourceId, principalId)),
    );
    return entries.reduce((bits, entry) => bits | (entry == null ? 0 : (valueNumber(entry.permBits) ?? 0)), 0);
  };

  const getEffectivePermissionsForResources = async (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    resourceIds: string[],
  ): Promise<Map<string, number>> => {
    const map = new Map<string, number>();
    await Promise.all(
      resourceIds.map(async (resourceId) => {
        const bits = await getEffectivePermissions(principals, resourceType, resourceId);
        if (bits > 0) {
          map.set(resourceId, bits);
        }
      }),
    );
    return map;
  };

  const findAccessibleResources = async (
    principals: Array<{ principalType: string; principalId: string }>,
    resourceType: string,
    requiredPermissions: number,
  ): Promise<string[]> => {
    const ids = new Set<string>();
    for (const principalId of userPrincipalIds(principals)) {
      const result = await client.send(
        new QueryCommand({
          TableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :principal AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: {
            ':principal': `PRINCIPAL#user#${principalId}`,
            ':prefix': `RESOURCE#${resourceType}#`,
          },
        }),
      );
      for (const item of (result.Items ?? []) as DynamoItem[]) {
        const bits = valueNumber(item.permBits) ?? 0;
        if ((bits & requiredPermissions) === requiredPermissions) {
          const resourceId = valueString(item.resourceId);
          if (resourceId != null) {
            ids.add(resourceId);
          }
        }
      }
    }
    return [...ids];
  };

  const findPublicResourceIds = async (): Promise<string[]> => [];
  const findEntriesByPrincipalsAndResource = async (): Promise<DynamoItem[]> => [];

  const aggregateAclEntries = async (pipeline: unknown[]): Promise<DynamoItem[]> => {
    const match = (pipeline[0] as DynamoItem | undefined)?.$match as DynamoItem | undefined;
    const resourceType = valueString(match?.resourceType);
    const principalType = valueString(match?.principalType);
    const permBitsMatch = valueNumber(match?.permBits);
    const resourceIdClause = match?.resourceId;
    const resourceIds =
      resourceIdClause != null && typeof resourceIdClause === 'object' && Array.isArray((resourceIdClause as DynamoItem).$in)
        ? (((resourceIdClause as DynamoItem).$in as unknown[]).filter((v): v is string => typeof v === 'string'))
        : typeof resourceIdClause === 'string'
          ? [resourceIdClause]
          : undefined;
    if (resourceType == null || resourceIds == null) {
      throw new Error('Unsupported ACL aggregation pipeline for DynamoDB');
    }
    const results: DynamoItem[] = [];
    for (const resourceId of resourceIds) {
      const queried = await client.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `RESOURCE#${resourceType}#${resourceId}` },
        }),
      );
      const candidates = ((queried.Items ?? []) as DynamoItem[])
        .filter((item) => principalType == null || item.principalType === principalType)
        .filter((item) => permBitsMatch == null || valueNumber(item.permBits) === permBitsMatch)
        .sort((a, b) => String(a.grantedAt ?? '').localeCompare(String(b.grantedAt ?? '')));
      if (candidates.length > 0) {
        results.push({ _id: resourceId, principalId: candidates[0].principalId });
      }
    }
    return results;
  };

  const deleteAclEntries = async (params: {
    resourceType: string;
    resourceId: string;
  }): Promise<{ deletedCount: number }> => {
    const result = await client.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `RESOURCE#${params.resourceType}#${params.resourceId}` },
      }),
    );
    const items = (result.Items ?? []) as DynamoItem[];
    await Promise.all(
      items.map((item) => client.send(new DeleteCommand({ TableName, Key: { PK: item.PK, SK: item.SK } }))),
    );
    return { deletedCount: items.length };
  };

  return {
    findRoleByIdentifier,
    findRolesByResourceType,
    grantPermission,
    getUserPrincipals,
    hasPermission,
    getEffectivePermissions,
    getEffectivePermissionsForResources,
    findAccessibleResources,
    findPublicResourceIds,
    findEntriesByPrincipalsAndResource,
    aggregateAclEntries,
    deleteAclEntries,
  };
}
