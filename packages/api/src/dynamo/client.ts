import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';

export interface DynamoClientConfig {
  endpoint?: string;
  region?: string;
}

export interface DynamoConnectionLogger {
  info: (message: string) => void;
}

export function createDynamoDocumentClient(config: DynamoClientConfig): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: config.region,
    ...(config.endpoint == null || config.endpoint === '' ? {} : { endpoint: config.endpoint }),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      convertClassInstanceToMap: false,
      removeUndefinedValues: true,
    },
  });
}

export function createDynamoConnector(
  client: DynamoDBDocumentClient,
  tableName: string,
  logger: DynamoConnectionLogger,
): () => Promise<DynamoDBDocumentClient> {
  return async () => {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    logger.info(`Connected to DynamoDB table ${tableName}`);
    return client;
  };
}
