import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DYNAMO_ITEM_LIMIT_BYTES, DynamoItemTooLargeError, createDynamoCoreMethods } from './core';

type SentCommand = GetCommand | PutCommand | TransactWriteCommand;

const mockClient = () => {
  const send = jest.fn<Promise<object>, [SentCommand]>(async () => ({}));
  return {
    client: { send } as unknown as DynamoDBDocumentClient,
    send,
  };
};

describe('DynamoDB core methods', () => {
  it('registers a normalized user and an email uniqueness lock transactionally', async () => {
    const { client, send } = mockClient();
    const methods = createDynamoCoreMethods(client, { tableName: 'core-test' });

    const created = await methods.createUser(
      { email: ' PERSON@Example.COM ', name: 'Person' },
      undefined,
      true,
      true,
    );

    expect(created).toEqual(
      expect.objectContaining({
        email: 'person@example.com',
        name: 'Person',
        provider: 'local',
      }),
    );
    if (typeof created === 'string') {
      throw new Error('Expected the requested user record');
    }
    expect(String(created._id)).toMatch(/^[a-f0-9]{24}$/);
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand)) {
      throw new Error('Expected a transactional user write');
    }
    expect(command.input.TransactItems).toEqual([
      expect.objectContaining({
        Put: expect.objectContaining({
          TableName: 'core-test',
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: expect.objectContaining({ SK: 'LOCK' }),
        }),
      }),
      expect.objectContaining({
        Put: expect.objectContaining({
          TableName: 'core-test',
          ConditionExpression: 'attribute_not_exists(PK)',
          Item: expect.objectContaining({ SK: 'PROFILE' }),
        }),
      }),
    ]);
  });

  it('propagates a conditional-write conflict from concurrent registration', async () => {
    const conflict = Object.assign(new Error('email already exists'), {
      name: 'TransactionCanceledException',
    });
    const send = jest
      .fn<Promise<object>, [SentCommand]>()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(conflict);
    const methods = createDynamoCoreMethods({ send } as unknown as DynamoDBDocumentClient, {
      tableName: 'core-test',
    });

    const outcomes = await Promise.allSettled([
      methods.createUser({ email: 'same@example.com' }),
      methods.createUser({ email: 'SAME@example.com' }),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(outcomes.find(({ status }) => status === 'rejected')).toEqual(
      expect.objectContaining({ reason: conflict }),
    );
  });

  it('rejects an oversized record before issuing a DynamoDB request', async () => {
    const { client, send } = mockClient();
    const methods = createDynamoCoreMethods(client);

    await expect(
      methods.createUser({
        email: 'large@example.com',
        payload: 'x'.repeat(DYNAMO_ITEM_LIMIT_BYTES),
      }),
    ).rejects.toBeInstanceOf(DynamoItemTooLargeError);
    expect(send).not.toHaveBeenCalled();
  });

  it('matches Mongoose forced-selection semantics for local authentication', async () => {
    const profile = {
      PK: 'USER#user-1',
      SK: 'PROFILE',
      _id: 'user-1',
      id: 'user-1',
      email: 'person@example.com',
      password: 'hashed-password',
      role: 'USER',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const send = jest
      .fn<Promise<object>, [SentCommand]>()
      .mockResolvedValueOnce({ Item: { userId: 'user-1' } })
      .mockResolvedValueOnce({ Item: profile })
      .mockResolvedValueOnce({ Item: { userId: 'user-1' } })
      .mockResolvedValueOnce({ Item: profile });
    const methods = createDynamoCoreMethods({ send } as unknown as DynamoDBDocumentClient, {
      tableName: 'core-test',
    });

    const normal = await methods.findUser({ email: 'person@example.com' });
    const authentication = await methods.findUser({ email: 'person@example.com' }, '+password');

    expect(normal).toEqual(
      expect.objectContaining({ id: 'user-1', email: 'person@example.com', role: 'USER' }),
    );
    expect(normal).not.toHaveProperty('password');
    expect(authentication).toEqual(
      expect.objectContaining({
        id: 'user-1',
        email: 'person@example.com',
        password: 'hashed-password',
        role: 'USER',
      }),
    );
  });

  it('allows chat only while the Dynamo user has no account-deletion fence', async () => {
    const send = jest
      .fn<Promise<object>, [SentCommand]>()
      .mockResolvedValueOnce({ Item: { PK: 'USER#user-1', SK: 'PROFILE', _id: 'user-1' } })
      .mockResolvedValueOnce({
        Item: {
          PK: 'USER#user-1',
          SK: 'PROFILE',
          _id: 'user-1',
          agentTriggerDeletionStartedAt: '2026-09-15T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({});
    const methods = createDynamoCoreMethods({ send } as unknown as DynamoDBDocumentClient);

    await expect(methods.isAgentTriggerPrincipalActive('user-1')).resolves.toBe(true);
    await expect(methods.isAgentTriggerPrincipalActive('user-1')).resolves.toBe(false);
    await expect(methods.isAgentTriggerPrincipalActive('missing-user')).resolves.toBe(false);
  });

  it('writes conversations and message locators through the existing method boundary', async () => {
    const { client, send } = mockClient();
    const methods = createDynamoCoreMethods(client, { tableName: 'core-test' });

    await methods.saveConvo(
      { userId: 'user-1' },
      { conversationId: 'conversation-1', title: 'Dynamo chat' },
    );
    await methods.saveMessage(
      { userId: 'user-1' },
      {
        messageId: 'message-1',
        conversationId: 'conversation-1',
        text: 'hello',
      },
    );

    expect(send.mock.calls.some(([command]) => command instanceof GetCommand)).toBe(true);
    expect(send.mock.calls.some(([command]) => command instanceof PutCommand)).toBe(true);
    const transaction = send.mock.calls
      .map(([command]) => command)
      .find((command) => command instanceof TransactWriteCommand);
    expect(transaction).toBeInstanceOf(TransactWriteCommand);
    if (!(transaction instanceof TransactWriteCommand)) {
      throw new Error('Expected a transactional message write');
    }
    expect(transaction.input.TransactItems).toHaveLength(2);
    expect(transaction.input.TransactItems?.[1]?.Put?.Item).toEqual(
      expect.objectContaining({
        PK: 'MESSAGE#message-1',
        SK: 'LOCATOR',
        conversationId: 'conversation-1',
      }),
    );
  });
});
