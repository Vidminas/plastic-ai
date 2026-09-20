import { logger } from '@librechat/data-schemas';
import { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';

let agentClient: BedrockAgentClient | null = null;
let agentRuntimeClient: BedrockAgentRuntimeClient | null = null;

const buildConfig = (): {
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} | null => {
  const region = process.env.BEDROCK_AWS_DEFAULT_REGION;
  if (!region) {
    logger.error('[bedrock-kb] BEDROCK_AWS_DEFAULT_REGION is not set. Cannot initialize Bedrock KB clients.');
    return null;
  }

  const endpoint = process.env.BEDROCK_KB_ENDPOINT_URL;
  const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;

  return {
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  };
};

/**
 * Control-plane client (knowledge base, data source, ingestion job management).
 * Credentials are shared with the Bedrock chat client's `BEDROCK_AWS_*` env vars —
 * this is deployment-level infrastructure, not a per-user/per-request client.
 */
export function initializeBedrockAgent(): BedrockAgentClient | null {
  if (agentClient) {
    return agentClient;
  }
  const config = buildConfig();
  if (!config) {
    return null;
  }
  agentClient = new BedrockAgentClient(config);
  logger.info('[bedrock-kb] Bedrock Agent (control plane) client initialized.');
  return agentClient;
}

/** Data-plane client (Retrieve). See {@link initializeBedrockAgent} for credential/config notes. */
export function initializeBedrockAgentRuntime(): BedrockAgentRuntimeClient | null {
  if (agentRuntimeClient) {
    return agentRuntimeClient;
  }
  const config = buildConfig();
  if (!config) {
    return null;
  }
  agentRuntimeClient = new BedrockAgentRuntimeClient(config);
  logger.info('[bedrock-kb] Bedrock Agent Runtime (data plane) client initialized.');
  return agentRuntimeClient;
}
