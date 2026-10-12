import type { AppConfig } from '@librechat/data-schemas';
import { getGuardrailTextMasker } from './mask';

type MaskingConfig = Pick<AppConfig, 'piiMasking'> | undefined;

/**
 * Masks text a user writes before the app stores it: a message they send or edit, or a
 * conversation title they set. Returns it unchanged when masking is not configured, or for a
 * value that is not a non-empty string. Throws when masking fails, so nothing unmasked is
 * stored.
 */
export async function maskUserText<T>(appConfig: MaskingConfig, text: T): Promise<T> {
  const maskText = getGuardrailTextMasker(appConfig);
  if (maskText == null || typeof text !== 'string' || text === '') {
    return text;
  }
  return (await maskText(text)) as T;
}

/** Masks quoted excerpts ("Add to chat") a message carries, which can hold earlier text. */
export async function maskUserQuotes(
  appConfig: MaskingConfig,
  quotes: string[] | null,
): Promise<string[] | null> {
  if (quotes == null) {
    return quotes;
  }
  return Promise.all(quotes.map((quote) => maskUserText(appConfig, quote)));
}
