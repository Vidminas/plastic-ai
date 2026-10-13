import { logger } from '@librechat/data-schemas';
import { AGENCY_QUESTION_IDS, agencyGoalSchema } from 'librechat-data-provider';
import type { TAgencyConfig, TConversationGoal } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { AgencyEventRecorder } from './events';
import { maskUserText } from '~/guardrails/stored';

const { clarify, goalCheck } = AGENCY_QUESTION_IDS;

/**
 * The system-tail block for a turn: the conversation's goal, and with `goalChecks`, when to
 * offer the learner options through `ask_user_question` rather than answer. Null when there is
 * nothing to add.
 */
export function buildGoalContext({
  goal,
  goalChecks,
}: {
  goal: string | null;
  goalChecks: boolean;
}): string | null {
  const lines: string[] = [];
  if (goal) {
    lines.push(
      "The learner set this goal for the conversation. Keep your help aimed at it, in service of the learner's own thinking:",
      `<conversation_goal>\n${goal}\n</conversation_goal>`,
    );
  }
  if (goalChecks) {
    lines.push(
      `If a request is unclear or could reasonably mean quite different things, do not guess: call ask_user_question with one question whose id is "${clarify}" and 2 to 4 distinct options, then answer what the learner chooses.`,
    );
    if (goal) {
      lines.push(
        `If a request works against the goal above, or drifts well away from it, first check with the learner: call ask_user_question with one question whose id is "${goalCheck}", briefly saying how the request differs from the goal, with exactly these option values: "continue" (carry on with this request), "refocus" (go back to the goal), and "goal_changed" (the learner's goal has changed). Then follow their choice.`,
      );
    }
    lines.push(
      'Otherwise just answer. Do not end replies with unprompted lists of follow-up suggestions.',
    );
  }
  return lines.length === 0 ? null : lines.join('\n\n');
}

/**
 * `context` with the agency block after it, as the run's shared context. A resumed run rebuilds
 * its context from attachments only, so the goal and the goal-check instructions are added back
 * here, read afresh so a goal changed while the run was paused is the one the model sees.
 */
export function withAgencyContext(context: string | undefined, agency: string | null): string {
  return [context, agency].filter((part): part is string => !!part).join('\n\n');
}

type GoalRequest = {
  config?: Pick<AppConfig, 'agency'> & Partial<AppConfig>;
  user?: { id?: string };
  body?: { goal?: unknown };
};

export interface AgencyContextDeps {
  getConversationGoal(userId: string, conversationId: string): Promise<TConversationGoal | null>;
  setConversationGoal(
    userId: string,
    conversationId: string,
    text: string,
  ): Promise<TConversationGoal>;
  record: AgencyEventRecorder;
}

const isOn = (agency: TAgencyConfig | undefined): agency is TAgencyConfig =>
  agency != null && (agency.conversationGoal || agency.goalChecks);

/**
 * The agency context for this turn of `conversationId`. The goal a learner sets on a new
 * conversation arrives with its first message (`body.goal`), already screened by the
 * safeguarding check with that message; it is masked and saved once, and read back on later
 * turns. A failure to read or save the goal is logged and the turn goes on without it.
 */
export async function resolveAgencyContext(
  req: GoalRequest,
  conversationId: string | undefined,
  deps: AgencyContextDeps,
): Promise<string | null> {
  const agency = req.config?.agency;
  if (!isOn(agency)) {
    return null;
  }
  const userId = req.user?.id;
  let goal: string | null = null;
  if (agency.conversationGoal && userId && conversationId) {
    try {
      goal = (await deps.getConversationGoal(userId, conversationId))?.text ?? null;
      const submitted = agencyGoalSchema.safeParse({ text: req.body?.goal });
      if (goal == null && submitted.success) {
        goal = await maskUserText(req.config ?? {}, submitted.data.text);
        await deps.setConversationGoal(userId, conversationId, goal);
        deps.record.event({ userId, conversationId, type: 'goal_set' });
      }
    } catch (error) {
      logger.warn('[agency] Could not resolve the conversation goal', {
        error: (error as Error)?.message,
      });
    }
  }
  return buildGoalContext({ goal, goalChecks: agency.goalChecks });
}
