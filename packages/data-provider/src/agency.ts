import { z } from 'zod';

/**
 * The four parts of the AE-AI questionnaire, as factors a learner rates for importance:
 * guiding and adjusting the AI, checking and improving its answers, going beyond it, and
 * reflecting on how they use it.
 */
export const AGENCY_FACTORS = ['guiding', 'checking', 'beyond', 'reflecting'] as const;
export type AgencyFactor = (typeof AGENCY_FACTORS)[number];

/** 1 (not at all important) to 5 (extremely important). */
export const agencyImportanceSchema = z.number().int().min(1).max(5);

/** Longest a single intentions field or conversation goal may be, in characters. */
export const AGENCY_TEXT_MAX = 2000;

const agencyTextSchema = z.string().trim().max(AGENCY_TEXT_MAX);

/** A stable id written in librechat.yaml: lower case, digits, `_` and `-`. */
const configIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

/** Adds an issue for each `id` already used earlier in `items`. */
const uniqueIds =
  (field: string) =>
  (items: ReadonlyArray<{ id: string }>, ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: `"${item.id}" is already used in ${field}`,
        });
      }
      seen.add(item.id);
    });
  };

/** Longest a suggested goal's title may be, in characters. */
export const GOAL_SUGGESTION_TITLE_MAX = 200;

/** Icons a suggested goal may show, mapped to lucide icons in the client. */
export const GOAL_SUGGESTION_ICONS = [
  'book',
  'calculator',
  'clock',
  'compass',
  'flask',
  'globe',
  'heart',
  'lightbulb',
  'pen',
  'run',
  'target',
  'users',
] as const;
export type GoalSuggestionIcon = (typeof GOAL_SUGGESTION_ICONS)[number];

/** A goal the goal card suggests. The title and description are the study's own copy. */
export const goalSuggestionSchema = z.object({
  id: configIdSchema,
  title: z.string().trim().min(1).max(GOAL_SUGGESTION_TITLE_MAX),
  description: z.string().trim().max(400).optional(),
  icon: z.enum(GOAL_SUGGESTION_ICONS).optional(),
});
export type TGoalSuggestion = z.infer<typeof goalSuggestionSchema>;

/**
 * `agency` in librechat.yaml: features that support a learner's agency over their own
 * learning. Every switch defaults to off, so without the block nothing changes.
 */
export const agencySchema = z.object({
  /** A sidebar dialog for long-term goals, intended use, commitments and AE-AI factor ratings. */
  intentions: z.boolean().default(false),
  /** A skippable goal card on new conversations; the goal goes into the model's context. */
  conversationGoal: z.boolean().default(false),
  /**
   * Instruct the model to offer options (`ask_user_question`) when a request is unclear or
   * drifts from the conversation goal. Needs the tool enabled on the model specs.
   */
  goalChecks: z.boolean().default(false),
  /** The agency recap page and its sidebar link. */
  recap: z.boolean().default(false),
  /**
   * Goals the conversation goal card suggests: the learner can pick one, add their own words to
   * it, or write their own, and the recap groups conversations by the suggestion they started
   * from. Unset, the card asks for the learner's own words only.
   */
  goalSuggestions: z
    .array(goalSuggestionSchema)
    .min(1)
    .max(12)
    .superRefine(uniqueIds('goalSuggestions'))
    .optional(),
});
export type TAgencyConfig = z.infer<typeof agencySchema>;

export const agencyIntentionsSchema = z.object({
  goals: agencyTextSchema.default(''),
  intendedUse: agencyTextSchema.default(''),
  commitments: agencyTextSchema.default(''),
  factors: z
    .object(
      Object.fromEntries(
        AGENCY_FACTORS.map((factor) => [factor, agencyImportanceSchema.optional()]),
      ) as Record<AgencyFactor, z.ZodOptional<typeof agencyImportanceSchema>>,
    )
    .strict()
    .default({}),
});
export type TAgencyIntentionsInput = z.input<typeof agencyIntentionsSchema>;
export type TAgencyIntentions = z.infer<typeof agencyIntentionsSchema> & {
  updatedAt?: string;
};

/**
 * A conversation's goal: what the learner wants from it, in their words, and the suggested goal
 * it started from, if any (`suggestionId: null` drops it).
 */
export const agencyGoalSchema = z.object({
  text: agencyTextSchema.min(1),
  suggestionId: configIdSchema.nullable().optional(),
});

/** A conversation's goal, as stored on the conversation. */
export type TConversationGoal = {
  text: string;
  suggestionId?: string;
  setAt?: string;
};

/** How a learner answered a goal check. */
export const GOAL_CHECK_OUTCOMES = ['continue', 'refocus', 'goal_changed'] as const;
export type GoalCheckOutcome = (typeof GOAL_CHECK_OUTCOMES)[number];
export const isGoalCheckOutcome = (value: string | undefined): value is GoalCheckOutcome =>
  (GOAL_CHECK_OUTCOMES as readonly string[]).includes(value ?? '');

/** `ask_user_question` ids the goal-check instructions tell the model to use. */
export const AGENCY_QUESTION_IDS = {
  clarify: 'clarify',
  goalCheck: 'goal_check',
} as const;

export const AGENCY_EVENT_TYPES = [
  'intentions_updated',
  'goal_set',
  'goal_skipped',
  'goal_updated',
  'options_offered',
  'option_selected',
  'goal_check_offered',
  'goal_check_resolved',
  'recap_viewed',
] as const;
export type AgencyEventType = (typeof AGENCY_EVENT_TYPES)[number];

/** Events only the browser can see, which it reports through `POST /api/agency/events`. */
export const CLIENT_AGENCY_EVENT_TYPES = ['goal_skipped', 'recap_viewed'] as const;
export const clientAgencyEventSchema = z.object({
  type: z.enum(CLIENT_AGENCY_EVENT_TYPES),
  conversationId: z.string().max(64).optional(),
});
export type TClientAgencyEvent = z.infer<typeof clientAgencyEventSchema>;

/** One recorded engagement with an agency feature. */
export type TAgencyEvent = {
  type: AgencyEventType;
  conversationId?: string;
  messageId?: string;
  detail?: string;
  createdAt: string;
};

export type TAgencyRecap = {
  /** New conversations with a goal set, and all new conversations. */
  goals: { set: number; conversations: number };
  /** Options the learner chose, and option questions offered. */
  options: { selected: number; offered: number };
  /** Goal checks offered, and how each answered one was resolved. */
  goalChecks: { offered: number } & Record<GoalCheckOutcome, number>;
  /** The latest example of each kind, for "View in chat". */
  examples: Partial<Record<'goal' | 'option' | 'goalCheck', TAgencyEvent>>;
};
