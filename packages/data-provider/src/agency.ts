import { z } from 'zod';
import { AGENCY_PROMPT_MAX, checkAgencyPrompt } from './agencyPrompt';

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
 * What the background classifier labels each learner message as: the kind of support asked
 * for. Fixed, so the client can name each one in the learner's language.
 */
export const AGENCY_SUPPORT_TYPES = [
  'explanation',
  'hint',
  'quiz',
  'ideas',
  'feedback',
  'answer',
  'other',
] as const;
export type AgencySupportType = (typeof AGENCY_SUPPORT_TYPES)[number];

/** The topic every conversation can fall back to, whatever the configured topics are. */
export const AGENCY_OTHER_TOPIC = 'other';
/** A conversation the classifier has not labelled (yet). */
export const AGENCY_UNCLASSIFIED_TOPIC = 'unclassified';

/** Longest a classifier prompt written in librechat.yaml may be, in characters. */
export const AGENCY_CLASSIFIER_PROMPT_MAX = 4000;

/** Most topics a study can configure: the recap gives each a colour of its own. */
export const AGENCY_TOPICS_MAX = 7;

const agencyTopicSchema = z.object({
  id: configIdSchema.refine((id) => id !== AGENCY_OTHER_TOPIC && id !== AGENCY_UNCLASSIFIED_TOPIC, {
    message: `"${AGENCY_OTHER_TOPIC}" and "${AGENCY_UNCLASSIFIED_TOPIC}" are reserved`,
  }),
  label: z.string().trim().min(1).max(80),
});
export type TAgencyTopic = z.infer<typeof agencyTopicSchema>;

/**
 * `agency` in librechat.yaml: features that support a learner's agency over their own
 * learning. Every switch defaults to off, so without the block nothing changes.
 */
export const agencySchema = z.object({
  /** A sidebar dialog for long-term goals, intended use, commitments and AE-AI factor ratings. */
  intentions: z.boolean().default(false),
  /**
   * A skippable goal card on new conversations, and the hidden instructions every turn carries
   * (`promptTemplate`, or the learner's own), with the goal in them.
   */
  conversationGoal: z.boolean().default(false),
  /**
   * The template of the hidden instructions, for learners who have not written their own. Unset,
   * `DEFAULT_AGENCY_PROMPT`; empty, their messages go on their own.
   */
  promptTemplate: z
    .string()
    .trim()
    .max(AGENCY_PROMPT_MAX)
    .superRefine((template, ctx) => {
      const check = checkAgencyPrompt(template);
      if (!check.ok) {
        for (const { code, line, tag } of check.errors) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${code} at line ${line}: ${tag}` });
        }
      }
    })
    .optional(),
  /** The agency recap page and its sidebar link. */
  recap: z.boolean().default(false),
  /**
   * A sidebar button that opens a reflection: fixed questions about one moment the learner
   * decided how to use the AI, which they can save, review and edit, as often as they like.
   */
  reflections: z.boolean().default(false),
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
  /**
   * A small model that labels, in the background, the kind of support each learner message asks
   * for and each conversation's general topic, for the recap. Only the labels are kept. Unset,
   * nothing is labelled and the recap leaves out support types and topics.
   */
  classifier: z
    .object({
      endpoint: z.string().min(1),
      model: z.string().min(1),
      /**
       * The study's general topics; `other` is always added. At most seven, one per colour the
       * recap can tell apart.
       */
      topics: z
        .array(agencyTopicSchema)
        .max(AGENCY_TOPICS_MAX)
        .default([])
        .superRefine(uniqueIds('topics')),
      /**
       * The question the classifier is asked about the topic, in place of its default, followed by
       * the list of topics. The rules around it (the conversation is data, the reply's shape) stay
       * fixed.
       */
      prompts: z
        .object({
          topics: z.string().trim().min(1).max(AGENCY_CLASSIFIER_PROMPT_MAX).optional(),
        })
        .optional(),
    })
    .optional(),
});
export type TAgencyConfig = z.infer<typeof agencySchema>;

/**
 * `agency` as the browser receives it: the classifier's topics, not its endpoint or model, and not
 * the hidden instructions, which the Parameters panel reads when it opens.
 */
export type TAgencyStartupConfig = Omit<TAgencyConfig, 'classifier' | 'promptTemplate'> & {
  classifier?: { topics: TAgencyTopic[] };
};

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

/**
 * The questions of a reflection, in the order they are asked: a moment the learner decided how
 * to use the AI (or not to), what they did, why, how it went, and whether they are happy with
 * it. Fixed, so the client can ask each in the learner's language.
 */
export const AGENCY_REFLECTION_QUESTIONS = [
  'working_on',
  'decision',
  'reason',
  'outcome',
  'happy',
] as const;
export type AgencyReflectionQuestion = (typeof AGENCY_REFLECTION_QUESTIONS)[number];

export type TAgencyReflectionAnswers = Record<AgencyReflectionQuestion, string>;

/** A reflection's answers; any question may be skipped, but not every one. */
export const agencyReflectionSchema = z
  .object({
    answers: z
      .object(
        Object.fromEntries(
          AGENCY_REFLECTION_QUESTIONS.map((question) => [question, agencyTextSchema.default('')]),
        ) as Record<AgencyReflectionQuestion, z.ZodDefault<typeof agencyTextSchema>>,
      )
      .strict(),
  })
  .strict()
  .refine((reflection) => Object.values(reflection.answers).some((answer) => answer.length > 0), {
    message: 'Answer at least one question',
  });
export type TAgencyReflectionInput = z.input<typeof agencyReflectionSchema>;

/** A saved reflection: when it was first saved, and when it was last edited. */
export type TAgencyReflection = {
  id: string;
  answers: TAgencyReflectionAnswers;
  createdAt: string;
  updatedAt: string;
};

/** The periods the recap covers. */
export const RECAP_RANGES = ['7d', '30d', 'all'] as const;
export type RecapRange = (typeof RECAP_RANGES)[number];

/** How a learner answered a goal check. */
export const GOAL_CHECK_OUTCOMES = ['continue', 'refocus', 'goal_changed'] as const;
export type GoalCheckOutcome = (typeof GOAL_CHECK_OUTCOMES)[number];
export const isGoalCheckOutcome = (value: string | undefined): value is GoalCheckOutcome =>
  (GOAL_CHECK_OUTCOMES as readonly string[]).includes(value ?? '');

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
  'support_classified',
  'topic_classified',
  'reflection_saved',
  'reflection_updated',
  'prompt_customised',
  'prompt_reset',
] as const;
export type AgencyEventType = (typeof AGENCY_EVENT_TYPES)[number];

/** Events only the browser can see, which it reports through `POST /api/agency/events`. */
export const CLIENT_AGENCY_EVENT_TYPES = ['goal_skipped', 'recap_viewed'] as const;
export const clientAgencyEventSchema = z.object({
  type: z.enum(CLIENT_AGENCY_EVENT_TYPES),
  conversationId: z.string().max(64).optional(),
});
export type TClientAgencyEvent = z.infer<typeof clientAgencyEventSchema>;

/** One step of the learner's goal journey, newest first in the recap. */
export type TAgencyJourneyItem = {
  /** A conversation goal set or changed, a goal check answered, or a reflection. */
  type: 'goal_set' | 'goal_updated' | 'goal_check' | 'reflection';
  at: string;
  /** For `goal_set` and `goal_updated`: the conversation's goal as it was set then. */
  goal?: TConversationGoal;
  /** For `goal_check`: how the learner answered it. */
  outcome?: GoalCheckOutcome;
  /** For `reflection`: the saved reflection, and what the learner was working on. */
  reflectionId?: string;
  about?: string;
  conversationId?: string;
  messageId?: string;
};

/** The key conversations without a suggested goal are grouped under. */
export const AGENCY_OWN_GOAL = 'own';

/**
 * The chats in the recap's period that had a goal, grouped by the suggested goal they started
 * from, or `own` for goals in the learner's words.
 */
export type TAgencyGoalUsage = {
  /** A suggestion's id, or `own`. */
  goal: string;
  /** Chats with a learner message in the period. */
  conversations: number;
  /** Labelled messages per support type. */
  support: Partial<Record<AgencySupportType, number>>;
  /** Chats per topic id (or `unclassified`). */
  topics: Record<string, number>;
};

/**
 * What the learner used the AI for in a period, and how their goals have changed. It counts
 * chats and shares, not message volume: the page shows what the AI was used for, not how much.
 */
export type TAgencyRecap = {
  /** Chats with a learner message in the period. */
  chats: number;
  /** Chats per topic id (or `unclassified`), largest first. Empty without a classifier. */
  topics: Array<{ id: string; chats: number }>;
  /** Labelled messages per support type in the period. Empty without a classifier. */
  support: Partial<Record<AgencySupportType, number>>;
  /** Chats in the period by goal, most first. */
  goalUsage: TAgencyGoalUsage[];
  /** Chats in the period without a goal. */
  noGoal: { conversations: number };
  /** Up to 20 steps of the goal journey in the period, newest first. */
  journey: TAgencyJourneyItem[];
  /** Reflections saved in the period: how many, and the latest few, newest first. */
  reflections: { count: number; recent: TAgencyReflection[] };
};
