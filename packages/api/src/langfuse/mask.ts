import type { MaskText } from '~/guardrails';

/** The Langfuse span processor's `mask` hook: given an exported value, returns its masked form. */
export type LangfuseMask = (params: { data: unknown }) => Promise<unknown>;

const DEFAULT_CONCURRENCY = 8;

/** Every string inside a parsed value, keys excluded. */
function collectStrings(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') {
    into.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, into));
  } else if (value != null && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, into));
  }
  return into;
}

function replaceStrings(value: unknown, masked: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return masked.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceStrings(item, masked));
  }
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceStrings(item, masked)]),
    );
  }
  return value;
}

async function maskAll(
  texts: Iterable<string>,
  maskText: MaskText,
  concurrency: number,
): Promise<Map<string, string>> {
  const queue = [...texts];
  const masked = new Map<string, string>();
  const worker = async (): Promise<void> => {
    for (let text = queue.shift(); text !== undefined; text = queue.shift()) {
      masked.set(text, await maskText(text));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return masked;
}

/**
 * Masks what a Langfuse trace exports with a guardrail masker. `@librechat/agents` hands
 * over one exported value at a time: input, output and metadata (whole or per key), model
 * parameters, status messages and exception text, often serialized as JSON. Every string
 * inside is masked and the JSON rebuilt, so keys and structure survive. A value that isn't
 * JSON is masked as text.
 *
 * A failed masking call throws, so the value is exported as a fully-masked placeholder.
 */
export function createGuardrailTraceMask(
  maskText: MaskText,
  { concurrency = DEFAULT_CONCURRENCY }: { concurrency?: number } = {},
): LangfuseMask {
  const maskValue = async (value: unknown): Promise<unknown> =>
    replaceStrings(value, await maskAll(collectStrings(value, new Set()), maskText, concurrency));

  return async ({ data }) => {
    if (typeof data !== 'string') {
      return maskValue(data);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return maskText(data);
    }
    if (parsed !== null && typeof parsed === 'object') {
      return JSON.stringify(await maskValue(parsed));
    }
    if (typeof parsed === 'string') {
      return JSON.stringify(await maskText(parsed));
    }
    return data;
  };
}
