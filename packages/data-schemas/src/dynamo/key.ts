import { ErrorTypes } from 'librechat-data-provider';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_DYNAMO_TABLE, valueString } from './core';
import type { DynamoCoreConfig, DynamoItem } from './core';
import { decrypt, encrypt } from '~/crypto';

/**
 * DynamoDB port of the `Key` collection (`packages/data-schemas/src/methods/key.ts`)
 * — per-user, per-provider stored API keys (`getUserKey`/`updateUserKey`), used
 * whenever an endpoint is configured `user_provided` (e.g. `ANTHROPIC_API_KEY=
 * user_provided` in `.env`). Blocks every chat turn on such a deployment when
 * missing entirely, since `initializeAgent` calls it unconditionally to build
 * the LLM client — not a capability that can be safely no-op'd.
 */

const keyItemKey = (userId: string, name: string): DynamoItem => ({ PK: `KEY#${userId}#${name}`, SK: 'DETAIL' });

const toStoredItem = (item: DynamoItem): DynamoItem => JSON.parse(JSON.stringify(item)) as DynamoItem;

export interface DynamoKeyMethods {
  getUserKey: (params: { userId: string; name: string }) => Promise<string>;
  updateUserKey: (params: {
    userId: string;
    name: string;
    value: string;
    expiresAt?: Date | null;
  }) => Promise<DynamoItem>;
  deleteUserKey: (params: { userId: string; name?: string; all?: boolean }) => Promise<{ deletedCount: number }>;
  getUserKeyValues: (params: { userId: string; name: string }) => Promise<Record<string, string>>;
  getUserKeyExpiry: (params: { userId: string; name: string }) => Promise<{ expiresAt: Date | 'never' | null }>;
}

export function createDynamoKeyMethods(client: DynamoDBDocumentClient, config: DynamoCoreConfig = {}): DynamoKeyMethods {
  const TableName = config.tableName ?? DEFAULT_DYNAMO_TABLE;

  const getItem = async (userId: string, name: string): Promise<DynamoItem | null> => {
    const result = await client.send(
      new GetCommand({ TableName, Key: keyItemKey(userId, name), ConsistentRead: true }),
    );
    return result.Item == null ? null : (result.Item as DynamoItem);
  };

  const getUserKey = async (params: { userId: string; name: string }): Promise<string> => {
    const item = await getItem(params.userId, params.name);
    const encryptedValue = item == null ? undefined : valueString(item.value);
    if (encryptedValue == null) {
      throw new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
    }
    return decrypt(encryptedValue);
  };

  const getUserKeyValues = async (params: { userId: string; name: string }): Promise<Record<string, string>> => {
    const userValues = await getUserKey(params);
    try {
      return JSON.parse(userValues) as Record<string, string>;
    } catch {
      throw new Error(JSON.stringify({ type: ErrorTypes.INVALID_USER_KEY }));
    }
  };

  const getUserKeyExpiry = async (params: {
    userId: string;
    name: string;
  }): Promise<{ expiresAt: Date | 'never' | null }> => {
    const item = await getItem(params.userId, params.name);
    if (item == null) {
      return { expiresAt: null };
    }
    return { expiresAt: item.expiresAt instanceof Date ? item.expiresAt : 'never' };
  };

  const updateUserKey = async (params: {
    userId: string;
    name: string;
    value: string;
    expiresAt?: Date | null;
  }): Promise<DynamoItem> => {
    const encryptedValue = await encrypt(params.value);
    const item: DynamoItem = {
      ...keyItemKey(params.userId, params.name),
      userId: params.userId,
      name: params.name,
      value: encryptedValue,
      ...(params.expiresAt ? { expiresAt: params.expiresAt.toISOString() } : {}),
      GSI1PK: `USER#${params.userId}`,
      GSI1SK: `KEY#${params.name}`,
    };
    await client.send(new PutCommand({ TableName, Item: toStoredItem(item) }));
    return item;
  };

  const deleteUserKey = async (params: {
    userId: string;
    name?: string;
    all?: boolean;
  }): Promise<{ deletedCount: number }> => {
    if (!params.all) {
      if (params.name == null) {
        return { deletedCount: 0 };
      }
      await client.send(new DeleteCommand({ TableName, Key: keyItemKey(params.userId, params.name) }));
      return { deletedCount: 1 };
    }
    const result = await client.send(
      new QueryCommand({
        TableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :user AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':user': `USER#${params.userId}`, ':prefix': 'KEY#' },
      }),
    );
    const items = (result.Items ?? []) as DynamoItem[];
    await Promise.all(
      items.map((item) => client.send(new DeleteCommand({ TableName, Key: { PK: item.PK, SK: item.SK } }))),
    );
    return { deletedCount: items.length };
  };

  return { getUserKey, updateUserKey, deleteUserKey, getUserKeyValues, getUserKeyExpiry };
}
