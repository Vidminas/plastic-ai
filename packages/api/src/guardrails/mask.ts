import { createHash } from 'node:crypto';
import { ApplyGuardrailCommand } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { AppConfig } from '@librechat/data-schemas';
import { getGuardrailTarget } from './runtime';
import { chunkText } from './chunk';

/** Replaces the identifiers in a text with the guardrail's tags, such as `{EMAIL}`. */
export type MaskText = (text: string) => Promise<string>;

const DEFAULT_CACHE_SIZE = 5_000;
/** Shorter strings cannot hold an identifier, so they are not sent. */
const MIN_MASKED_LENGTH = 3;

/**
 * Masks text with a Bedrock guardrail's sensitive information filters, through the
 * standalone ApplyGuardrail API as if it were a prompt (`source: 'INPUT'`), so the result
 * matches what the model receives when the same guardrail guards a Converse call.
 *
 * Results are kept in a bounded in-memory cache keyed by a hash of the text, and requests
 * for a text already being masked share one call, because traces and conversations send the
 * same history again and again. Errors are thrown, never answered with the original text.
 * Text longer than one request takes is split at whitespace and masked in pieces, so an
 * identifier that itself contains a space can be missed where a piece ends.
 */
export function createGuardrailTextMasker({
  client,
  guardrailIdentifier,
  guardrailVersion,
  cacheSize = DEFAULT_CACHE_SIZE,
}: {
  client: Pick<BedrockRuntimeClient, 'send'>;
  guardrailIdentifier: string;
  guardrailVersion: string;
  cacheSize?: number;
}): MaskText {
  const cache = new Map<string, string>();
  const inFlight = new Map<string, Promise<string>>();

  const remember = (key: string, masked: string): void => {
    cache.delete(key);
    cache.set(key, masked);
    if (cache.size > cacheSize) {
      cache.delete(cache.keys().next().value as string);
    }
  };

  const applyToChunk = async (text: string): Promise<string> => {
    const { action, outputs = [] } = await client.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier,
        guardrailVersion,
        source: 'INPUT',
        content: [{ text: { text } }],
      }),
    );
    if (action !== 'GUARDRAIL_INTERVENED') {
      return text;
    }
    return outputs.map((output) => output.text ?? '').join('');
  };

  /** Text over one request's limit is masked a piece at a time, split at whitespace. */
  const apply = async (text: string): Promise<string> => {
    const masked: string[] = [];
    for (const chunk of chunkText(text)) {
      masked.push(await applyToChunk(chunk));
    }
    return masked.join('');
  };

  return async (text) => {
    if (text.trim().length < MIN_MASKED_LENGTH) {
      return text;
    }
    const key = createHash('sha256').update(text).digest('hex');
    const cached = cache.get(key);
    if (cached !== undefined) {
      remember(key, cached);
      return cached;
    }
    let pending = inFlight.get(key);
    if (pending == null) {
      pending = apply(text).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const masked = await pending;
    remember(key, masked);
    /** Masking again changes nothing, so text stored masked costs no second call. */
    if (masked !== text) {
      remember(createHash('sha256').update(masked).digest('hex'), masked);
    }
    return masked;
  };
}

let sharedMasker: { signature: string; maskText: MaskText } | null = null;

/**
 * The masker for the guardrail `piiMasking.guardrail` names, or `undefined` when masking is
 * not configured (see `getGuardrailTarget` for how it is resolved). One masker, and so one
 * cache, is shared per guardrail and process.
 */
export function getGuardrailTextMasker(
  appConfig: Pick<AppConfig, 'piiMasking'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MaskText | undefined {
  const target = getGuardrailTarget(appConfig?.piiMasking?.guardrail, env);
  if (target == null) {
    return undefined;
  }
  if (sharedMasker?.signature !== target.signature) {
    sharedMasker = { signature: target.signature, maskText: createGuardrailTextMasker(target) };
  }
  return sharedMasker.maskText;
}
