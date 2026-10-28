import { z } from 'zod';

/** `ask_user_question` ids the goal-check instructions tell the model to use. */
export const AGENCY_QUESTION_IDS = {
  clarify: 'clarify',
  goalCheck: 'goal_check',
} as const;

const { clarify, goalCheck } = AGENCY_QUESTION_IDS;

/** Longest a learner's hidden instructions may be, in characters. */
export const AGENCY_PROMPT_MAX = 8000;

/** The names a hidden-instructions template may use, as `{{name}}` or `{{#name}}…{{/name}}`. */
export const AGENCY_PROMPT_VARIABLES = ['goal'] as const;
export type AgencyPromptVariable = (typeof AGENCY_PROMPT_VARIABLES)[number];

/**
 * The hidden instructions every turn carries unless `agency.promptTemplate` replaces them or
 * the learner has written their own: the conversation goal, when there is one, and when to offer
 * options through `ask_user_question` instead of answering.
 */
export const DEFAULT_AGENCY_PROMPT = [
  "{{#goal}}The learner set this goal for the conversation. Keep your help aimed at it, in service of the learner's own thinking:",
  '<conversation_goal>\n{{goal}}\n</conversation_goal>',
  `{{/goal}}If a request is unclear or could reasonably mean quite different things, do not guess: call ask_user_question with one question whose id is "${clarify}" and 2 to 4 distinct options, then answer what the learner chooses.{{#goal}}`,
  `If a request works against the goal above, or drifts well away from it, first check with the learner: call ask_user_question with one question whose id is "${goalCheck}", briefly saying how the request differs from the goal, with exactly these option values: "continue" (carry on with this request), "refocus" (go back to the goal), and "goal_changed" (the learner's goal has changed). Then follow their choice.{{/goal}}`,
  'Otherwise just answer. Do not end replies with unprompted lists of follow-up suggestions.',
].join('\n\n');

/** The hidden instructions a learner starts from, and goes back to on a reset. */
export const defaultAgencyPrompt = (agency?: { promptTemplate?: string } | null): string =>
  agency?.promptTemplate ?? DEFAULT_AGENCY_PROMPT;

export const agencyPromptSchema = z
  .object({ template: z.string().max(AGENCY_PROMPT_MAX) })
  .strict();

/**
 * A learner's prompt template; `template: null` means the default applies, and an empty one that
 * their messages go on their own.
 */
export type TAgencyPrompt = {
  template: string | null;
  updatedAt?: string;
};

export type TAgencyPromptResponse = { prompt: TAgencyPrompt; default: string };
export type TAgencyPromptSaved = { prompt: TAgencyPrompt; masked: boolean };

export const AGENCY_PROMPT_ERROR_CODES = [
  'malformed_tag',
  'unknown_variable',
  'unknown_section',
  'unexpected_close',
  'mismatched_close',
  'unclosed_section',
] as const;
export type AgencyPromptErrorCode = (typeof AGENCY_PROMPT_ERROR_CODES)[number];

/** A template mistake, at the 1-based line and column of the tag it concerns. */
export type TAgencyPromptError = {
  code: AgencyPromptErrorCode;
  line: number;
  column: number;
  /** The tag as written, e.g. `{{/goal}}`. */
  tag: string;
  /** For `mismatched_close`: the section still open, e.g. `goal`. */
  expected?: string;
};

export type TAgencyPromptCheck = { ok: true } | { ok: false; errors: TAgencyPromptError[] };

const TAG_BODY = /^([#/]?)([A-Za-z_][A-Za-z0-9_]*)$/;
const isVariable = (name: string): name is AgencyPromptVariable =>
  (AGENCY_PROMPT_VARIABLES as readonly string[]).includes(name);

/** The 1-based line and column of `index` in `text`. */
function positionOf(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const lineStart = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, column: index - lineStart + 1 };
}

/**
 * Checks a hidden-instructions template: every `{{…}}` tag is well formed and names a known
 * variable, and every section that opens closes, in order. Reports every mistake, not just the
 * first, so the editor can list them all. An empty template is fine: it adds nothing to a turn.
 */
export function checkAgencyPrompt(template: string): TAgencyPromptCheck {
  const errors: TAgencyPromptError[] = [];
  const at = (code: AgencyPromptErrorCode, index: number, tag: string, expected?: string) =>
    errors.push({ code, ...positionOf(template, index), tag, ...(expected ? { expected } : {}) });
  const open: Array<{ name: string; index: number; tag: string }> = [];

  let cursor = template.indexOf('{{');
  while (cursor !== -1) {
    const end = template.indexOf('}}', cursor + 2);
    if (end === -1) {
      at('malformed_tag', cursor, template.slice(cursor, cursor + 20));
      break;
    }
    const tag = template.slice(cursor, end + 2);
    const match = TAG_BODY.exec(template.slice(cursor + 2, end));
    if (match == null) {
      at('malformed_tag', cursor, tag);
    } else {
      const [, kind, name] = match;
      if (!isVariable(name)) {
        at(kind === '' ? 'unknown_variable' : 'unknown_section', cursor, tag);
      }
      if (kind === '#') {
        open.push({ name, index: cursor, tag });
      } else if (kind === '/') {
        const innermost = open[open.length - 1];
        if (innermost == null) {
          at('unexpected_close', cursor, tag);
        } else if (innermost.name !== name) {
          at('mismatched_close', cursor, tag, innermost.name);
          const depth = open.map((section) => section.name).lastIndexOf(name);
          if (depth !== -1) {
            open.length = depth;
          }
        } else {
          open.pop();
        }
      }
    }
    cursor = template.indexOf('{{', end + 2);
  }
  for (const section of open) {
    at('unclosed_section', section.index, section.tag);
  }
  errors.sort((a, b) => a.line - b.line || a.column - b.column);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** An innermost section: one that opens no other section before it closes. */
const SECTION = /\{\{#([A-Za-z_][A-Za-z0-9_]*)\}\}((?:(?!\{\{#)[\s\S])*?)\{\{\/\1\}\}/;

/**
 * The hidden instructions for one turn, from a template `checkAgencyPrompt` accepts: sections
 * whose variable is empty are left out, `{{goal}}` becomes the goal, the blank lines around a
 * removed section shrink to one (the learner's own spacing stays), and an empty result is `null`.
 */
export function renderAgencyPrompt(
  template: string,
  values: Record<AgencyPromptVariable, string | null>,
): string | null {
  /** Marks where a section was left out, so only the blank lines around it shrink. */
  const REMOVED = '\uE000';
  let text = template.split(REMOVED).join('');
  for (let match = SECTION.exec(text); match != null; match = SECTION.exec(text)) {
    const value = isVariable(match[1]) ? values[match[1]] : null;
    text =
      text.slice(0, match.index) +
      (value ? match[2] : REMOVED) +
      text.slice(match.index + match[0].length);
  }
  text = text
    .replace(/\n*(?:\uE000\n*)+/g, (gap) => {
      const newlines = gap.split('\n').length - 1;
      return newlines >= 2 ? '\n\n' : '\n'.repeat(newlines);
    })
    .replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_tag, name: string) =>
      isVariable(name) ? (values[name] ?? '') : '',
    )
    .trim();
  return text === '' ? null : text;
}
