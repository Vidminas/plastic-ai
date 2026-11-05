/** Longest the system content or the message of a sent prompt is kept, in characters. */
export const SENT_PROMPT_TEXT_MAX = 64_000;

/** Everything the model got on one turn, as its first model call saw it. */
export type TSentPrompt = {
  /** The system content: instructions, hidden instructions, memory, file and tool context. */
  system: string;
  /** The user's message as the model received it, masked, with inline file context. */
  message: string;
  /** How many earlier messages went with it. */
  historyCount: number;
  /** The names of the tools the model was offered. */
  tools: string[];
  /** Whether `system` or `message` was cut at `SENT_PROMPT_TEXT_MAX`. */
  truncated: boolean;
  createdAt?: string;
};
