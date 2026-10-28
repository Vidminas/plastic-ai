import { logger } from '@librechat/data-schemas';
import { agencyGoalSchema, defaultAgencyPrompt, renderAgencyPrompt } from 'librechat-data-provider';
import type { TAgencyPrompt, TConversationGoal } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { AgencyEventRecorder } from './events';
import { getSafeErrorMetadata } from '~/utils/errors';
import { maskUserText } from '~/guardrails/stored';
import { suggestionOf } from './handlers';

/**
 * `context` with the agency block after it, as the run's shared context. A resumed run rebuilds
 * its context from attachments only, so the hidden instructions are added back here, read
 * afresh so a goal or template changed while the run was paused is the one the model sees.
 */
export function withAgencyContext(context: string | undefined, agency: string | null): string {
  return [context, agency].filter((part): part is string => !!part).join('\n\n');
}

type GoalRequest = {
  config?: Pick<AppConfig, 'agency'> & Partial<AppConfig>;
  user?: { id?: string };
  body?: { goal?: unknown; goalSuggestionId?: unknown };
};

export interface AgencyContextDeps {
  getConversationGoal(userId: string, conversationId: string): Promise<TConversationGoal | null>;
  setConversationGoal(
    userId: string,
    conversationId: string,
    text: string,
    suggestionId?: string | null,
  ): Promise<TConversationGoal>;
  /** The learner's own hidden instructions; null when the default applies. */
  getAgencyPrompt(userId: string): Promise<TAgencyPrompt | null>;
  record: AgencyEventRecorder;
}

/** The learner's own template, or the default when they have none or it cannot be read. */
async function templateFor(
  req: GoalRequest,
  userId: string | undefined,
  deps: AgencyContextDeps,
): Promise<string> {
  const fallback = defaultAgencyPrompt(req.config?.agency);
  if (!userId) {
    return fallback;
  }
  try {
    return (await deps.getAgencyPrompt(userId))?.template ?? fallback;
  } catch (error) {
    logger.warn('[agency] Could not read the hidden instructions', getSafeErrorMetadata(error));
    return fallback;
  }
}

/** The conversation's goal, saving the one a new conversation's first message sets. */
async function goalFor(
  req: GoalRequest,
  userId: string,
  conversationId: string,
  deps: AgencyContextDeps,
): Promise<string | null> {
  let goal: string | null = null;
  try {
    goal = (await deps.getConversationGoal(userId, conversationId))?.text ?? null;
    const submitted = agencyGoalSchema.safeParse({ text: req.body?.goal });
    if (goal == null && submitted.success) {
      goal = await maskUserText(req.config ?? {}, submitted.data.text);
      const requested = req.body?.goalSuggestionId;
      const suggestionId =
        typeof requested === 'string' && suggestionOf(req, requested) != null
          ? requested
          : undefined;
      await deps.setConversationGoal(userId, conversationId, goal, suggestionId);
      deps.record.event({ userId, conversationId, type: 'goal_set', detail: goal });
    }
  } catch (error) {
    logger.warn('[agency] Could not resolve the conversation goal', getSafeErrorMetadata(error));
  }
  return goal;
}

/**
 * The hidden instructions for this turn of `conversationId`, with `agency.conversationGoal`:
 * the learner's own template, or `agency.promptTemplate`, with the conversation's goal. The goal
 * a learner sets on a new conversation arrives with its first message (`body.goal`), already
 * screened by the safeguarding check with that message; it is masked and saved once, and read
 * back on later turns. The suggested goal it started from (`body.goalSuggestionId`) is kept with
 * it when `agency.goalSuggestions` has it. The template and the goal are read together; a
 * failure to read either is logged and the turn goes on with the default or without the goal.
 */
export async function resolveAgencyContext(
  req: GoalRequest,
  conversationId: string | undefined,
  deps: AgencyContextDeps,
): Promise<string | null> {
  if (req.config?.agency?.conversationGoal !== true) {
    return null;
  }
  const userId = req.user?.id;
  const [template, goal] = await Promise.all([
    templateFor(req, userId, deps),
    userId && conversationId ? goalFor(req, userId, conversationId, deps) : null,
  ]);
  return renderAgencyPrompt(template, { goal });
}
