import { ApplyGuardrailCommand } from '@aws-sdk/client-bedrock-runtime';
import type { UploadScreeningPiiEntity } from 'librechat-data-provider';
import type { GuardrailTarget } from '~/guardrails/runtime';
import { chunkText } from '~/guardrails/chunk';

export { chunkText };

/** Finds personal identifiers in text; resolves to the kinds found, empty when none. */
export interface PiiDetector {
  detect(text: string): Promise<string[]>;
}

/** Characters repeated at the start of each chunk, so an identifier on a boundary is whole in one. */
const CHUNK_OVERLAP = 200;

/**
 * Screens text with a Bedrock guardrail's sensitive information filters through the
 * ApplyGuardrail API, one chunk at a time, stopping at the first chunk with one of `entities`.
 * Every PII type the guardrail reports counts, whatever action its policy takes on it; types
 * outside `entities`, and its custom regexes, never refuse an upload. Only the entity types
 * leave this function, never the text or where it matched.
 *
 * The guardrail validates checksums where a type has one (an NHS number that fails it is not
 * reported).
 */
export function createGuardrailDetector({
  client,
  guardrailIdentifier,
  guardrailVersion,
  entities,
}: Pick<GuardrailTarget, 'client' | 'guardrailIdentifier' | 'guardrailVersion'> & {
  entities: readonly UploadScreeningPiiEntity[];
}): PiiDetector {
  const screened = new Set<string>(entities);

  const find = async (chunk: string): Promise<string[]> => {
    const { assessments = [] } = await client.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier,
        guardrailVersion,
        source: 'INPUT',
        content: [{ text: { text: chunk } }],
      }),
    );
    const found = new Set<string>();
    for (const assessment of assessments) {
      for (const { type, detected } of assessment.sensitiveInformationPolicy?.piiEntities ?? []) {
        if (type != null && detected !== false && screened.has(type)) {
          found.add(type);
        }
      }
    }
    return [...found];
  };

  return {
    async detect(text) {
      for (const chunk of chunkText(text, undefined, CHUNK_OVERLAP)) {
        if (!chunk.trim()) {
          continue;
        }
        const found = await find(chunk);
        if (found.length > 0) {
          return found;
        }
      }
      return [];
    },
  };
}

/** For environments without Bedrock guardrails, such as local ministack. */
export const noPiiDetector: PiiDetector = { detect: async () => [] };
