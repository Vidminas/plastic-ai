import { z } from 'zod';
import { tool } from '@librechat/agents/langchain/tools';
import {
  ASK_USER_QUESTION_ID_PATTERN,
  MAX_ASK_USER_QUESTIONS,
  askUserQuestion,
  askUserQuestions,
} from '@librechat/agents';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { ToolInputValidationError } from '../toolValidation';
import type { MaskText } from '~/guardrails';
import { recordToolInputValidationError } from '../toolValidation';

/**
 * Tool name. Deliberately identical to the SDK's interrupt discriminator
 * (`AskUserQuestionInterruptPayload.type === 'ask_user_question'`) and the client
 * content-part type the merged question card renders — the whole pipeline keys on
 * this one string.
 */
export const ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

/**
 * Length caps double as the sanitization story: every one of these strings is
 * model-generated and rendered verbatim (as text nodes — React escapes) in the
 * client question card, so bound them here rather than trusting the model.
 */
const QUESTION_MAX = 2000;
const DESCRIPTION_MAX = 4000;
const HEADER_MAX = 80;
const OPTION_LABEL_MAX = 280;
const OPTION_VALUE_MAX = 500;
const OPTIONS_MAX = 12;

const OPTION_LABEL_DESCRIPTION =
  `Short choice shown to the user. Maximum ${OPTION_LABEL_MAX} characters; ` +
  'put supporting context in the question description.';
const OPTION_LABEL_MAX_ERROR =
  `Option labels must be ${OPTION_LABEL_MAX} characters or fewer. ` +
  'Shorten the label and retry.';

const ASK_USER_QUESTION_DESCRIPTION = [
  'Ask the user one to four related clarifying questions and pause the run until they answer;',
  "their answers are returned as this tool's result, keyed by each question id. Use it only",
  'when you are genuinely blocked on decisions you cannot resolve from the conversation or your',
  'other tools. Put every related question in this ONE tool call, and NEVER call this tool in',
  'parallel with any other tool call. Use stable, concise ids matching',
  '[A-Za-z][A-Za-z0-9_-]{0,63}. When the realistic',
  'answers are enumerable, provide 2-6 concise options; set multiSelect to true only when',
  'several options may sensibly apply at once (the selected option values are returned joined',
  `by ", "). Keep every option label within ${OPTION_LABEL_MAX} characters and put supporting`,
  'context in the question description. The user can always type a free-form answer instead — so',
  'do NOT include a',
  "catch-all option like 'Other' or 'Something else': the answer UI always offers free-form",
  'input on its own.',
].join(' ');

/**
 * Mirrors the SDK's `AskUserQuestionsRequest`; the validated input is passed to
 * `askUserQuestions()` unchanged, so this schema is the wire shape inside the
 * pending-action payload.
 */
const askUserQuestionItemSchema: z.ZodObject<
  {
    id: z.ZodString;
    header: z.ZodOptional<z.ZodString>;
    question: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<
      z.ZodArray<z.ZodObject<{ label: z.ZodString; value: z.ZodString }, 'strip'>, 'many'>
    >;
    multiSelect: z.ZodOptional<z.ZodBoolean>;
  },
  'strip'
> = z.object({
  id: z
    .string()
    .regex(ASK_USER_QUESTION_ID_PATTERN)
    .describe('Unique answer key for this question.'),
  header: z
    .string()
    .min(1)
    .max(HEADER_MAX)
    .optional()
    .describe('Optional short heading shown above the question.'),
  question: z
    .string()
    .min(1)
    .max(QUESTION_MAX)
    .describe('One clarifying question to ask the user.'),
  description: z
    .string()
    .max(DESCRIPTION_MAX)
    .optional()
    .describe('Optional context rendered alongside the question (why you are asking).'),
  options: z
    .array(
      z.object({
        label: z
          .string()
          .min(1)
          .max(OPTION_LABEL_MAX, OPTION_LABEL_MAX_ERROR)
          .describe(OPTION_LABEL_DESCRIPTION),
        value: z
          .string()
          .min(1)
          .max(OPTION_VALUE_MAX)
          .describe('Value returned as the answer if this option is picked.'),
      }),
    )
    .max(OPTIONS_MAX)
    .optional()
    .describe(
      'Optional pre-defined choices (2-6 recommended). Omit to require a free-form answer.',
    ),
  multiSelect: z
    .boolean()
    .optional()
    .describe('Allow the user to pick several options; their values are returned joined by ", ".'),
});

const askUserQuestionsArraySchema: z.ZodEffects<z.ZodArray<typeof askUserQuestionItemSchema>> = z
  .array(askUserQuestionItemSchema)
  .min(1)
  .max(MAX_ASK_USER_QUESTIONS)
  .refine(
    (questions) => new Set(questions.map((question) => question.id)).size === questions.length,
    {
      message: 'Question ids must be unique.',
    },
  )
  .describe('One to four related questions presented to the user in one interaction.');

const legacyAskUserQuestionToolSchema = askUserQuestionItemSchema.omit({ id: true, header: true });

export const askUserQuestionToolSchema: z.ZodObject<
  { questions: typeof askUserQuestionsArraySchema },
  'strip'
> = z.object({
  questions: askUserQuestionsArraySchema,
});

export type AskUserQuestionToolInput = z.infer<typeof askUserQuestionToolSchema>;

/** Explicit shape of {@link AskUserQuestionToolDefinition} (isolatedDeclarations). */
export interface AskUserQuestionToolDefinitionShape {
  name: string;
  description: string;
  schema: {
    type: 'object';
    properties: {
      questions: {
        type: 'array';
        minItems: number;
        maxItems: number;
        description: string;
        items: {
          type: 'object';
          properties: {
            id: { type: 'string'; pattern: string; description: string };
            header: { type: 'string'; minLength: number; maxLength: number; description: string };
            question: {
              type: 'string';
              minLength: number;
              maxLength: number;
              description: string;
            };
            description: { type: 'string'; maxLength: number; description: string };
            options: {
              type: 'array';
              maxItems: number;
              description: string;
              items: {
                type: 'object';
                properties: {
                  label: {
                    type: 'string';
                    minLength: number;
                    maxLength: number;
                    description: string;
                  };
                  value: {
                    type: 'string';
                    minLength: number;
                    maxLength: number;
                    description: string;
                  };
                };
                required: string[];
              };
            };
            multiSelect: { type: 'boolean'; description: string };
          };
          required: string[];
        };
      };
    };
    required: string[];
  };
}

/**
 * JSON-schema twin of {@link askUserQuestionToolSchema} for the schema-only tool
 * registry (`agentToolDefinitions` in `tools/registry/definitions.ts`), same shape the
 * Calculator/WebSearch builtin definitions use.
 */
export const AskUserQuestionToolDefinition: AskUserQuestionToolDefinitionShape = {
  name: ASK_USER_QUESTION_TOOL_NAME,
  description: ASK_USER_QUESTION_DESCRIPTION,
  schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_ASK_USER_QUESTIONS,
        description: 'One to four related questions presented in one interaction.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              pattern: ASK_USER_QUESTION_ID_PATTERN.source,
              description: 'Unique answer key for this question.',
            },
            header: {
              type: 'string',
              minLength: 1,
              maxLength: HEADER_MAX,
              description: 'Optional short heading shown above the question.',
            },
            question: {
              type: 'string',
              minLength: 1,
              maxLength: QUESTION_MAX,
              description: 'One clarifying question to ask the user.',
            },
            description: {
              type: 'string',
              maxLength: DESCRIPTION_MAX,
              description: 'Optional context rendered alongside the question.',
            },
            options: {
              type: 'array',
              maxItems: OPTIONS_MAX,
              description: 'Optional pre-defined choices. Omit for free-form only.',
              items: {
                type: 'object',
                properties: {
                  label: {
                    type: 'string',
                    minLength: 1,
                    maxLength: OPTION_LABEL_MAX,
                    description: OPTION_LABEL_DESCRIPTION,
                  },
                  value: {
                    type: 'string',
                    minLength: 1,
                    maxLength: OPTION_VALUE_MAX,
                    description: 'Value returned if this option is picked.',
                  },
                },
                required: ['label', 'value'],
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Allow several option values for this question.',
            },
          },
          required: ['id', 'question'],
        },
      },
    },
    required: ['questions'],
  },
};

/** The option values a question offered: the model wrote them, so they hold nothing personal. */
type OptionValues = ReadonlySet<string>;

const optionValues = (question: { options?: { value: string }[] }): OptionValues =>
  new Set((question.options ?? []).map((option) => option.value));

/**
 * Whether an answer is only the question's own option values: one value, or several joined by
 * ", " for a multi-select. Such an answer is passed through unmasked, because a guardrail reads
 * slug-like values (`just_starting`) as usernames, and a masked value matches no option. The
 * whole-answer check comes first because a single value may itself contain ", ".
 */
const isOptionAnswer = (answer: string, values: OptionValues): boolean =>
  values.has(answer) || answer.split(', ').every((part) => values.has(part));

/** Masks every string in a value, leaving keys and structure alone. */
async function maskStrings<T>(value: T, maskText: MaskText): Promise<T> {
  if (typeof value === 'string') {
    return (await maskText(value)) as T;
  }
  if (Array.isArray(value)) {
    return (await Promise.all(value.map((item) => maskStrings(item, maskText)))) as T;
  }
  if (value != null && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await maskStrings(item, maskText)]),
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

const maskAnswer = (answer: unknown, values: OptionValues, maskText: MaskText): Promise<unknown> =>
  typeof answer === 'string' && isOptionAnswer(answer, values)
    ? Promise.resolve(answer)
    : maskStrings(answer, maskText);

/**
 * Masks every string in a human's answers, leaving keys and structure alone, so an answer
 * reaches the model through its tool result with the same masking a typed message gets. The
 * one exception is an answer that is only the question's chosen option values, which is the
 * model's own text and passes through as it is.
 */
async function maskAnswers(
  resolution: unknown,
  questions: readonly { id?: string; options?: { value: string }[] }[],
  maskText: MaskText,
): Promise<unknown> {
  if (resolution == null || typeof resolution !== 'object' || Array.isArray(resolution)) {
    return maskStrings(resolution, maskText);
  }
  const byId = new Map(questions.map((question) => [question.id, optionValues(question)]));
  const maskEntry = async (key: string, item: unknown): Promise<unknown> => {
    if (key === 'answer') {
      return maskAnswer(item, optionValues(questions[0] ?? {}), maskText);
    }
    if (key !== 'answers' || item == null || typeof item !== 'object' || Array.isArray(item)) {
      return maskStrings(item, maskText);
    }
    const entries = await Promise.all(
      Object.entries(item).map(async ([id, value]) => [
        id,
        await maskAnswer(value, byId.get(id) ?? new Set(), maskText),
      ]),
    );
    return Object.fromEntries(entries);
  };
  const entries = await Promise.all(
    Object.entries(resolution).map(async ([key, item]) => [key, await maskEntry(key, item)]),
  );
  return Object.fromEntries(entries);
}

/**
 * Create the `ask_user_question` tool instance. The func calls the SDK's
 * `askUserQuestions()` helper, which raises a LangGraph `interrupt()` — on the first
 * pass execution unwinds (the run pauses; `run.getInterrupt().payload.type ===
 * 'ask_user_question'`), and on the resume pass it returns the host-supplied
 * `{ answers }`, which becomes the ToolMessage content the model sees.
 *
 * Requirements at the run level (wired in `agents/run.ts`): a checkpointer must be
 * attached (the interrupt must be durable to be resumable) and the tool must be
 * excluded from eager event execution (an interrupt raised outside the Pregel task
 * frame cannot pause the run). It does NOT require the tool-approval policy
 * (`humanInTheLoop`/hooks) — verified end-to-end in
 * `api/server/controllers/agents/__tests__/askUserQuestion.e2e.spec.js`.
 *
 * LangGraph resume contract (documented on the SDK helper): the tool body re-runs
 * from the top on the resume pass, and sibling tools in the same batch re-execute —
 * which is why the description forbids parallel calls.
 *
 * With `maskText`, each typed answer is masked before it becomes the ToolMessage: tool
 * results are never evaluated by a guardrail attached to the model call, and the answer is
 * text the human typed, like a message. A chosen option's value is the model's own text and
 * is passed through as it is.
 */
export function createAskUserQuestionTool(
  validationErrorsByToolCallId?: Map<string, ToolInputValidationError>,
  { maskText }: { maskText?: MaskText } = {},
): DynamicStructuredTool<typeof askUserQuestionToolSchema> {
  const toToolResult = async (
    resolution: unknown,
    questions: readonly { id?: string; options?: { value: string }[] }[],
  ): Promise<string> =>
    JSON.stringify(maskText ? await maskAnswers(resolution, questions, maskText) : resolution);

  /** Kept out of the provider-facing definition. A graph rebuilt during a
   * rolling deploy can still rerun checkpointed legacy `{ question, ... }`
   * arguments through this schema and consume its retained `{ answer }` resume. */
  const legacyAskTool = tool(
    async (input, config?: { toolCall?: { id?: string } }) => {
      const resolution = askUserQuestion(input, { toolCallId: config?.toolCall?.id });
      return toToolResult(resolution, [input]);
    },
    {
      name: ASK_USER_QUESTION_TOOL_NAME,
      description: ASK_USER_QUESTION_DESCRIPTION,
      schema: legacyAskUserQuestionToolSchema,
    },
  );
  const askTool = tool(
    async (input: AskUserQuestionToolInput, config?: { toolCall?: { id?: string } }) => {
      const resolution = askUserQuestions(input, { toolCallId: config?.toolCall?.id });
      return toToolResult(resolution, input.questions);
    },
    {
      name: ASK_USER_QUESTION_TOOL_NAME,
      description: ASK_USER_QUESTION_DESCRIPTION,
      schema: askUserQuestionToolSchema,
    },
  );

  /** LangChain validates the schema before starting tool callbacks. Catch at
   *  the tool boundary so the thrown validation error can be correlated with
   *  the real call ID without inferring failure from persisted output text. */
  const invoke = askTool.invoke.bind(askTool);
  askTool.invoke = (async (input, config) => {
    try {
      const candidate =
        typeof input === 'object' && input != null && 'args' in input ? input.args : input;
      if (legacyAskUserQuestionToolSchema.safeParse(candidate).success) {
        return await legacyAskTool.invoke(
          input as unknown as Parameters<typeof legacyAskTool.invoke>[0],
          config,
        );
      }
      return await invoke(input, config);
    } catch (error) {
      const toolCallId =
        typeof input === 'object' && input != null && 'id' in input ? input.id : undefined;
      recordToolInputValidationError(validationErrorsByToolCallId, error, toolCallId);
      throw error;
    }
  }) as typeof askTool.invoke;

  return askTool;
}
