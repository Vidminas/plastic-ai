/** Maximum number of explicit subagents per parent agent. UI + Zod schema share this. */
export const MAX_SUBAGENTS = 10;

/** Hard upper bound for `endpoints.agents.maxSubagents`, keeping the request-validation
 *  cap bounded no matter what the config file says. */
export const MAX_SUBAGENTS_CEILING = 50;

let maxSubagents = MAX_SUBAGENTS;

/** Effective subagents-per-agent cap; initialized from `endpoints.agents.maxSubagents` at startup. */
export const getMaxSubagents = (): number => maxSubagents;

/** Applies a configured cap; any missing or out-of-range value resets to the default. */
export const setMaxSubagents = (value: number | undefined): void => {
  maxSubagents =
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SUBAGENTS_CEILING
      ? value
      : MAX_SUBAGENTS;
};

/** Chat project field limits. The dialogs and the persistence layer share these,
 * so the inputs stop at the same point the server would otherwise truncate. */
export const MAX_CHAT_PROJECT_NAME_LENGTH = 100;
export const MAX_CHAT_PROJECT_DESCRIPTION_LENGTH = 1000;
export const MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH = 16000;
export const MAX_CHAT_PROJECT_FILES = 50;
/** Hard ceilings an operator cannot raise the configurable limits above. */
export const MAX_CHAT_PROJECT_DESCRIPTION_LENGTH_CEILING = 10000;
export const MAX_CHAT_PROJECT_INSTRUCTIONS_LENGTH_CEILING = 200000;
export const MAX_CHAT_PROJECT_FILES_CEILING = 500;

/** Mirrors the bounded graph-child member limit in `@librechat/agents`. */
export const MAX_GRAPH_SUBAGENT_MEMBERS = 32;

/** Characters of retained tool output one stopped turn may be tokenized for, so the
 *  context gauge can add an exact figure instead of an estimate. The schema default
 *  and the save path share it; tokenizing runs ~60 ms/MB, once per stopped turn. */
export const DEFAULT_MAX_RETAINED_TOOL_COUNT_CHARS = 8 * 1024 * 1024;

/** Token ceiling for the block of Ask User answers carried verbatim in an agent's
 *  user context (`endpoints.agents.askUserQuestion.retainedAnswers.maxTokens`).
 *  Older answers drop first once the block exceeds it; the newest set is always kept. */
export const DEFAULT_RETAINED_ANSWER_TOKENS = 4096;

/**
 * Counts characters the way a reader does: by Unicode code point, so an emoji counts
 * once rather than as the two UTF-16 units `String.prototype.length` reports. The
 * composer and the server both count with this, so they agree on what is too long.
 */
export function countMessageCharacters(text: string): number {
  let count = 0;
  for (const _character of text) {
    count++;
  }
  return count;
}

/** Whether `text` is longer than `max` characters (`messageLimits.maxUserMessageChars`). */
export function exceedsMessageLength(text: string, max: number | undefined): boolean {
  if (max == null) {
    return false;
  }
  /** A string never holds more code points than UTF-16 units, so short ones skip the count. */
  return text.length > max && countMessageCharacters(text) > max;
}
