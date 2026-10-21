import { logger } from '@librechat/data-schemas';
import {
  ErrorTypes,
  agencyGoalSchema,
  agencyIntentionsSchema,
  clientAgencyEventSchema,
} from 'librechat-data-provider';
import type {
  TAgencyRecap,
  TAgencyConfig,
  TConversationGoal,
  TAgencyIntentions,
  TSafeguardingErrorInfo,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { AgencyEventRecorder } from './events';
import { participantOf, screenForSafeguarding } from '~/safeguarding/service';
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
  getAgencyRecap(userId: UserId, options?: { conversationId?: string }): Promise<TAgencyRecap>;
  /** Resolves when the user owns the conversation; null when there is no such conversation. */
  getConvo(userId: UserId, conversationId: string): Promise<unknown>;
  record: AgencyEventRecorder;
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
      logger.error(`[agency] ${label} failed`, { userId, error: (error as Error)?.message });
      return res.status(500).json({ message: `Failed to ${label}` });
    }
  };
}

const conversationIdOf = (req: Request): string | null => {
  const { conversationId } = req.params as { conversationId?: string };
  return typeof conversationId === 'string' && conversationId.length <= 64 && conversationId
    ? conversationId
    : null;
};

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
  event: { source: 'goal' | 'intentions'; conversationId?: string },
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
      if ((await deps.getConvo(userId, conversationId)) == null) {
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
      deps.record.event({ userId, conversationId, type: 'goal_updated' });
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
      const { conversationId } = req.query as { conversationId?: unknown };
      const scope =
        typeof conversationId === 'string' && conversationId && conversationId.length <= 64
          ? { conversationId }
          : undefined;
      return res.json(await deps.getAgencyRecap(userId, scope));
    }),
  };
}

/** A suggestion in `agency.goalSuggestions`, by its id. */
export function suggestionOf(
  req: { config?: Pick<AppConfig, 'agency'> },
  id: string,
): { id: string; title: string } | undefined {
  return req.config?.agency?.goalSuggestions?.find((suggestion) => suggestion.id === id);
}
