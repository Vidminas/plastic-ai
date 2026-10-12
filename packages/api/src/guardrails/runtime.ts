import { extractEnvVariable } from 'librechat-data-provider';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

/** A guardrail to call ApplyGuardrail on, with the client to call it through. */
export interface GuardrailTarget {
  readonly client: Pick<BedrockRuntimeClient, 'send'>;
  readonly guardrailIdentifier: string;
  readonly guardrailVersion: string;
  /** Identifies the guardrail and region, for sharing state built on it. */
  readonly signature: string;
}

const clients = new Map<string, BedrockRuntimeClient>();

/** A value with its `${ENV}` reference resolved; an unset reference stays literal, so is none. */
function resolveConfigured(value: string | undefined): string | undefined {
  const resolved = value == null ? undefined : extractEnvVariable(value);
  return resolved && !/^\$\{.+\}$/.test(resolved) ? resolved : undefined;
}

/**
 * The guardrail `config` names, or `undefined` when it names none. `${ENV}` references are
 * resolved as for the model calls, and the client uses the same region and credentials
 * (`BEDROCK_AWS_DEFAULT_REGION`, then `AWS_REGION`; `BEDROCK_AWS_PROFILE` when set, else the
 * default chain such as a task role). One client is shared per region and profile; it
 * rate-limits itself and retries throttled calls, since chat, traces and uploads share the
 * account's ApplyGuardrail quota.
 */
export function getGuardrailTarget(
  config: { guardrailIdentifier?: string; guardrailVersion?: string } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): GuardrailTarget | undefined {
  const guardrailIdentifier = resolveConfigured(config?.guardrailIdentifier);
  const guardrailVersion = resolveConfigured(config?.guardrailVersion);
  if (!guardrailIdentifier || !guardrailVersion) {
    return undefined;
  }
  const region = env.BEDROCK_AWS_DEFAULT_REGION ?? env.AWS_REGION;
  const profile = env.BEDROCK_AWS_PROFILE;
  const clientKey = `${region}|${profile ?? ''}`;
  let client = clients.get(clientKey);
  if (client == null) {
    client = new BedrockRuntimeClient({
      region,
      retryMode: 'adaptive',
      maxAttempts: 8,
      ...(profile ? { credentials: fromNodeProviderChain({ profile }) } : {}),
    });
    clients.set(clientKey, client);
  }
  return {
    client,
    guardrailIdentifier,
    guardrailVersion,
    signature: `${region}|${guardrailIdentifier}|${guardrailVersion}`,
  };
}
