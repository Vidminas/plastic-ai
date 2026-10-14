import { ApplyGuardrailCommand } from '@aws-sdk/client-bedrock-runtime';
import type { TSafeguarding } from 'librechat-data-provider';
import type { SafeguardingAssessment, SafeguardingLevels } from './assess';
import type { GuardrailTarget } from '~/guardrails/runtime';
import { assessGuardrail, mergeAssessments, NO_DETECTIONS } from './assess';
import { getGuardrailTarget } from '~/guardrails/runtime';
import { chunkText } from '~/guardrails/chunk';

/** Screens text that does not reach a model call through its guardrail. */
export interface SafeguardingScreener {
  /** Throws when the guardrail cannot be reached; every finding is a result. */
  screen(text: string): Promise<SafeguardingAssessment>;
}

/** Characters repeated at the start of each chunk, so a phrase on a boundary is whole in one. */
const CHUNK_OVERLAP = 200;

/**
 * Screens text with the safeguarding guardrail's content filters, denied topics and word
 * filters through ApplyGuardrail, a chunk at a time, stopping once a chunk is blocked. The
 * guardrail only detects; `levels` decide what each confidence means. Only the categories,
 * names and confidences leave this function, never the text.
 */
export function createSafeguardingScreener({
  client,
  guardrailIdentifier,
  guardrailVersion,
  levels,
}: Pick<GuardrailTarget, 'client' | 'guardrailIdentifier' | 'guardrailVersion'> & {
  levels: SafeguardingLevels;
}): SafeguardingScreener {
  const screenChunk = async (chunk: string): Promise<SafeguardingAssessment> => {
    const { assessments = [] } = await client.send(
      new ApplyGuardrailCommand({
        guardrailIdentifier,
        guardrailVersion,
        source: 'INPUT',
        outputScope: 'FULL',
        content: [{ text: { text: chunk } }],
      }),
    );
    return assessGuardrail(assessments, levels);
  };

  return {
    async screen(text) {
      const parts: SafeguardingAssessment[] = [];
      for (const chunk of chunkText(text, undefined, CHUNK_OVERLAP)) {
        if (!chunk.trim()) {
          continue;
        }
        const part = await screenChunk(chunk);
        parts.push(part);
        if (part.severity === 'block') {
          break;
        }
      }
      return parts.length === 0 ? NO_DETECTIONS : mergeAssessments(parts);
    },
  };
}

const screeners = new WeakMap<TSafeguarding, SafeguardingScreener>();

/**
 * The screener for `config.guardrail`, shared by every request with the same config. Throws
 * when the guardrail's `${ENV}` references are unset, since screening would otherwise be
 * silently off.
 */
export function getSafeguardingScreener(
  config: TSafeguarding,
  env: NodeJS.ProcessEnv = process.env,
): SafeguardingScreener {
  let screener = screeners.get(config);
  if (screener != null) {
    return screener;
  }
  const target = getGuardrailTarget(config.guardrail, env);
  if (target == null) {
    throw new Error('safeguarding is configured, but its guardrail ID or version is not set');
  }
  screener = createSafeguardingScreener({ ...target, levels: config });
  screeners.set(config, screener);
  return screener;
}
