import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import {
  ErrorTypes,
  RECAP_RANGES,
  agencyGoalSchema,
  checkAgencyPrompt,
  agencyPromptSchema,
  defaultAgencyPrompt,
  agencyReflectionSchema,
  agencyIntentionsSchema,
  clientAgencyEventSchema,
} from 'librechat-data-provider';
import type {
  RecapRange,
  TAgencyRecap,
  TAgencyPrompt,
  TAgencyConfig,
  TConversationGoal,
  TAgencyStartupConfig,
  TAgencyIntentions,
  TAgencyReflection,
  TSafeguardingErrorInfo,
  TAgencyReflectionAnswers,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { AgencyEventRecorder } from './events';
import { participantOf, screenForSafeguarding } from '~/safeguarding/service';
import { getSafeErrorMetadata } from '~/utils/errors';
import { maskUserText } from '~/guardrails/stored';

type UserId = string;

export interface AgencyHandlerDeps {
  getAgencyIntentions(userId: UserId): Promise<TAgencyIntentions | null>;
  setAgencyIntentions(
    userId: UserId,
    update: Omit<TAgencyIntentions, 'updatedAt'>,
  ): Promise<TAgencyIntentions>;
  getConversationGoal(userId: UserId, conversationId: string): Promise<TConversationGoal | null>;
  setConversationGoal(
    userId: UserId,
    conversationId: string,
    text: string,
    suggestionId?: string | null,
  ): Promise<TConversationGoal>;
  getAgencyRecap(
    userId: UserId,
    options?: { conversationId?: string; range?: RecapRange; signalIds?: string[] },
  ): Promise<TAgencyRecap>;
  listAgencyReflections(userId: UserId): Promise<TAgencyReflection[]>;
  createAgencyReflection(
    userId: UserId,
    answers: TAgencyReflectionAnswers,
  ): Promise<TAgencyReflection>;
  updateAgencyReflection(
    userId: UserId,
    reflectionId: string,
    answers: TAgencyReflectionAnswers,
  ): Promise<TAgencyReflection | null>;
  getAgencyPrompt(userId: UserId): Promise<TAgencyPrompt | null>;
  setAgencyPrompt(userId: UserId, template: string): Promise<TAgencyPrompt>;
  deleteAgencyPrompt(userId: UserId): Promise<void>;
  addAgencyPromptRevision(userId: UserId, template: string | null): Promise<string>;
  /** Resolves when the user owns the conversation; null when there is no such conversation. */
  getConvo(userId: UserId, conversationId: string): Promise<unknown>;
  record: AgencyEventRecorder;
  /**
   * Called after a conversation's goal changes, in the background, so the classifier can label
   * its topic again. Never awaited by the response.
   */
  onConversationGoalChanged?(req: Request, userId: UserId, conversationId: string): void;
}

type AgencyRequest = Request & {
  config?: AppConfig;
  user?: { id?: string; openidId?: string };
};

type Handler = (req: Request, res: Response) => Promise<unknown>;

export interface AgencyHandlers {
  getIntentions: Handler;
  putIntentions: Handler;
  getGoal: Handler;
  putGoal: Handler;
  postEvent: Handler;
  getRecap: Handler;
  getReflections: Handler;
  postReflection: Handler;
  patchReflection: Handler;
  getPrompt: Handler;
  putPrompt: Handler;
  deletePrompt: Handler;
}

const NOT_FOUND = { message: 'Not found' };

/** Runs `handle` for a signed-in user when `feature` is on; otherwise 401 or 404. */
function gated(
  feature: keyof TAgencyConfig | ((agency: TAgencyConfig) => boolean),
  label: string,
  handle: (req: AgencyRequest, res: Response, userId: UserId) => Promise<unknown>,
): Handler {
  const isOn = typeof feature === 'function' ? feature : (agency: TAgencyConfig) => agency[feature];
  return async (req, res) => {
    const request = req as AgencyRequest;
    const userId = request.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const agency = request.config?.agency;
    if (agency == null || !isOn(agency)) {
      return res.status(404).json(NOT_FOUND);
    }
    try {
      return await handle(request, res, userId);
    } catch (error) {
      logger.error(`[agency] ${label} failed`, { userId, ...getSafeErrorMetadata(error) });
      return res.status(500).json({ message: `Failed to ${label}` });
    }
  };
}

const validConversationId = (conversationId: unknown): string | null =>
  typeof conversationId === 'string' && conversationId.length <= 64 && conversationId
    ? conversationId
    : null;

const conversationIdOf = (req: Request): string | null =>
  validConversationId((req.params as { conversationId?: string }).conversationId);

type ScreenedText<K extends string> =
  | { ok: true; fields: Record<K, string> }
  | { ok: false; info: TSafeguardingErrorInfo };

/**
 * Masks what a learner wrote the way a prompt is masked, so no personal identifier is stored,
 * and screens it with `safeguarding`, so a disclosure reaches the safeguarding team even where
 * it never reaches a model (long-term intentions). The fields are masked one by one and
 * screened together. Returns the masked fields to store, or why they were blocked.
 */
export async function screenLearnerText<K extends string>(
  req: { config?: AppConfig; user?: { id?: string; openidId?: string } },
  fields: Record<K, string>,
  event: { source: 'goal' | 'intentions' | 'reflection' | 'instructions'; conversationId?: string },
): Promise<ScreenedText<K>> {
  const keys = Object.keys(fields) as K[];
  const masked = await Promise.all(keys.map((key) => maskUserText(req.config ?? {}, fields[key])));
  const result = {} as Record<K, string>;
  keys.forEach((key, i) => {
    result[key] = masked[i];
  });
  if (req.config?.safeguarding == null || req.user == null) {
    return { ok: true, fields: result };
  }
  const check = await screenForSafeguarding({
    appConfig: req.config,
    text: masked.filter((text) => text.trim()).join('\n\n'),
    event: {
      source: event.source,
      participant: participantOf(req.user),
      ...(event.conversationId ? { conversationId: event.conversationId } : {}),
    },
  });
  return check.ok ? { ok: true, fields: result } : { ok: false, info: check.info };
}

const DEFAULT_PROMPT: TAgencyPrompt = { template: null };

/** Blocked text answers 422 with the reasons; text that could not be screened answers 503. */
const blocked = (res: Response, info: TSafeguardingErrorInfo): Response =>
  res.status(info.unavailable ? 503 : 422).json({ type: ErrorTypes.SAFEGUARDING, info });

/**
 * The `/api/agency` routes: a learner's long-term intentions, a conversation's goal,
 * engagement events only the browser sees, and the recap. Each answers 404 while its
 * `agency` feature is off.
 */
export function createAgencyHandlers(deps: AgencyHandlerDeps): AgencyHandlers {
  return {
    getIntentions: gated(
      (agency) => agency.intentions || agency.recap,
      'load intentions',
      async (_req, res, userId) => res.json({ intentions: await deps.getAgencyIntentions(userId) }),
    ),

    putIntentions: gated('intentions', 'save intentions', async (req, res, userId) => {
      const parsed = agencyIntentionsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid intentions' });
      }
      const { goals, intendedUse, commitments, factors } = parsed.data;
      const screened = await screenLearnerText(
        req,
        { goals, intendedUse, commitments },
        { source: 'intentions' },
      );
      if (!screened.ok) {
        return blocked(res, screened.info);
      }
      const intentions = await deps.setAgencyIntentions(userId, { ...screened.fields, factors });
      deps.record.event({ userId, type: 'intentions_updated' });
      return res.json({ intentions });
    }),

    getGoal: gated('conversationGoal', 'load goal', async (req, res, userId) => {
      const conversationId = conversationIdOf(req);
      if (conversationId == null) {
        return res.status(400).json({ message: 'Invalid conversation' });
      }
      return res.json({ goal: await deps.getConversationGoal(userId, conversationId) });
    }),

    putGoal: gated('conversationGoal', 'save goal', async (req, res, userId) => {
      const conversationId = conversationIdOf(req);
      const parsed = agencyGoalSchema.safeParse(req.body);
      if (conversationId == null || !parsed.success) {
        return res.status(400).json({ message: 'Invalid goal' });
      }
      const { text, suggestionId } = parsed.data;
      if (suggestionId != null && suggestionOf(req, suggestionId) == null) {
        return res.status(400).json({ message: 'Unknown suggestion' });
      }
      const [convo, previous] = await Promise.all([
        deps.getConvo(userId, conversationId),
        deps.getConversationGoal(userId, conversationId),
      ]);
      if (convo == null) {
        return res.status(404).json(NOT_FOUND);
      }
      const screened = await screenLearnerText(req, { text }, { source: 'goal', conversationId });
      if (!screened.ok) {
        return blocked(res, screened.info);
      }
      const goal = await deps.setConversationGoal(
        userId,
        conversationId,
        screened.fields.text,
        suggestionId,
      );
      /** Saving the same words again is no change: no journey step, and no paid relabel. */
      if (goal.text !== previous?.text) {
        /** The goal as set, so the journey shows each change rather than the latest goal. */
        deps.record.event({ userId, conversationId, type: 'goal_updated', detail: goal.text });
        deps.onConversationGoalChanged?.(req, userId, conversationId);
      }
      return res.json({ goal });
    }),

    postEvent: gated(
      (agency) => agency.conversationGoal || agency.recap,
      'record event',
      async (req, res, userId) => {
        const parsed = clientAgencyEventSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: 'Invalid event' });
        }
        deps.record.event({ userId, ...parsed.data });
        return res.status(204).end();
      },
    ),

    getRecap: gated('recap', 'load recap', async (req, res, userId) => {
      const { conversationId, range } = req.query as { conversationId?: unknown; range?: unknown };
      if (range != null && !(RECAP_RANGES as readonly unknown[]).includes(range)) {
        return res.status(400).json({ message: 'Invalid range' });
      }
      const scoped = validConversationId(conversationId);
      const scope = scoped != null ? { conversationId: scoped } : {};
      return res.json(
        await deps.getAgencyRecap(userId, {
          ...scope,
          range: (range as RecapRange | undefined) ?? '7d',
          signalIds: req.config?.agency?.classifier?.signals?.map(({ id }) => id),
        }),
      );
    }),

    getReflections: gated('reflections', 'load reflections', async (_req, res, userId) =>
      res.json({ reflections: await deps.listAgencyReflections(userId) }),
    ),

    postReflection: gated('reflections', 'save reflection', async (req, res, userId) => {
      const answers = await screenedReflection(req, res);
      if (answers == null) {
        return res;
      }
      const reflection = await deps.createAgencyReflection(userId, answers);
      deps.record.event({ userId, type: 'reflection_saved', detail: reflection.id });
      return res.status(201).json({ reflection });
    }),

    patchReflection: gated('reflections', 'save reflection', async (req, res, userId) => {
      const { reflectionId } = req.params as { reflectionId?: string };
      if (typeof reflectionId !== 'string' || !isValidObjectIdString(reflectionId)) {
        return res.status(400).json({ message: 'Invalid reflection' });
      }
      const answers = await screenedReflection(req, res);
      if (answers == null) {
        return res;
      }
      const reflection = await deps.updateAgencyReflection(userId, reflectionId, answers);
      if (reflection == null) {
        return res.status(404).json(NOT_FOUND);
      }
      deps.record.event({ userId, type: 'reflection_updated', detail: reflection.id });
      return res.json({ reflection });
    }),

    getPrompt: gated('conversationGoal', 'load hidden instructions', async (req, res, userId) =>
      res.json({
        prompt: (await deps.getAgencyPrompt(userId)) ?? DEFAULT_PROMPT,
        default: defaultAgencyPrompt(req.config?.agency),
      }),
    ),

    /**
     * Saves the learner's hidden instructions, masked and screened like a goal, after checking
     * the template both as written and as masked, so a placeholder can never break a tag. The
     * default itself is saved as a reset. Each change adds to the instructions' log.
     */
    putPrompt: gated('conversationGoal', 'save hidden instructions', async (req, res, userId) => {
      const parsed = agencyPromptSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: 'Invalid hidden instructions' });
      }
      const { template } = parsed.data;
      const written = checkAgencyPrompt(template);
      if (!written.ok) {
        return res.status(400).json({ code: 'invalid_template', errors: written.errors });
      }
      if (template.trim() === defaultAgencyPrompt(req.config?.agency)) {
        await resetPrompt(deps, userId);
        return res.json({ prompt: DEFAULT_PROMPT, masked: false });
      }
      /** Nothing to mask or screen: the learner's messages go on their own. */
      if (template.trim() === '') {
        return res.json({ prompt: await saveCustomPrompt(deps, userId, ''), masked: false });
      }
      let screened: ScreenedText<'template'>;
      try {
        screened = await screenLearnerText(req, { template }, { source: 'instructions' });
      } catch (error) {
        logger.error('[agency] Could not mask hidden instructions', {
          userId,
          ...getSafeErrorMetadata(error),
        });
        return res.status(503).json({ message: 'Could not save hidden instructions' });
      }
      if (!screened.ok) {
        return blocked(res, screened.info);
      }
      const masked = screened.fields.template;
      const stored = checkAgencyPrompt(masked);
      if (!stored.ok) {
        return res.status(400).json({ code: 'invalid_template', errors: stored.errors });
      }
      const prompt = await saveCustomPrompt(deps, userId, masked, masked !== template);
      return res.json({ prompt, masked: masked !== template });
    }),

    deletePrompt: gated(
      'conversationGoal',
      'reset hidden instructions',
      async (_req, res, userId) => {
        await resetPrompt(deps, userId);
        return res.json({ prompt: DEFAULT_PROMPT });
      },
    ),
  };
}

/** Saves the learner's own template, then logs the change once it has taken effect. */
async function saveCustomPrompt(
  deps: AgencyHandlerDeps,
  userId: UserId,
  template: string,
  masked = false,
): Promise<TAgencyPrompt> {
  const prompt = await deps.setAgencyPrompt(userId, template);
  const revisionId = await deps.addAgencyPromptRevision(userId, template);
  deps.record.event({ userId, type: 'prompt_customised', detail: revisionId });
  logger.info('[agency] Hidden instructions changed', {
    userId,
    revisionId,
    length: template.length,
    masked,
  });
  return prompt;
}

/** Puts the learner back on the default instructions, and logs the reset. */
async function resetPrompt(deps: AgencyHandlerDeps, userId: UserId): Promise<void> {
  await deps.deleteAgencyPrompt(userId);
  const revisionId = await deps.addAgencyPromptRevision(userId, null);
  deps.record.event({ userId, type: 'prompt_reset', detail: revisionId });
  logger.info('[agency] Hidden instructions reset', { userId, revisionId });
}

/**
 * A reflection's answers from the request, masked one by one and screened together, as
 * reflection text. Answers 400 or the safeguarding refusal itself, and resolves null, when the
 * answers cannot be saved.
 */
async function screenedReflection(
  req: AgencyRequest,
  res: Response,
): Promise<TAgencyReflectionAnswers | null> {
  const parsed = agencyReflectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid reflection' });
    return null;
  }
  const screened = await screenLearnerText(req, parsed.data.answers, { source: 'reflection' });
  if (!screened.ok) {
    blocked(res, screened.info);
    return null;
  }
  return screened.fields;
}

/** A suggestion in `agency.goalSuggestions`, by its id. */
export function suggestionOf(
  req: { config?: Pick<AppConfig, 'agency'> },
  id: string,
): { id: string; title: string } | undefined {
  return req.config?.agency?.goalSuggestions?.find((suggestion) => suggestion.id === id);
}

/**
 * `agency` for the startup config: what the classifier labels, never its endpoint, model,
 * prompts or definitions, and not
 * the hidden instructions, which `getPrompt` sends when the Parameters panel opens.
 */
export function agencyStartupConfig(agency: TAgencyConfig): TAgencyStartupConfig {
  const { classifier, promptTemplate: _promptTemplate, ...rest } = agency;
  return classifier != null
    ? {
        ...rest,
        classifier: {
          topics: classifier.topics,
          /** A config cached before signs of agency has none, which must not fail startup. */
          signals: (classifier.signals ?? []).map(
            ({ definition: _definition, ...signal }) => signal,
          ),
        },
      }
    : rest;
}
