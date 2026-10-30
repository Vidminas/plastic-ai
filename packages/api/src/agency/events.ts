import { logger } from '@librechat/data-schemas';
import { AGENCY_QUESTION_IDS, isGoalCheckOutcome } from 'librechat-data-provider';
import type { AgencyEventType, TAgencyConfig } from 'librechat-data-provider';
import type { NextFunction, Request, Response } from 'express';
import type { SendOtlpSpan } from '~/safeguarding/sink';
import { getDefaultOtlpSpanSender } from '~/safeguarding/sink';
import { getSafeErrorMetadata } from '~/utils/errors';

export interface AgencyEventInput {
  userId: string;
  type: AgencyEventType;
  conversationId?: string;
  messageId?: string;
  detail?: string;
  /** For signs of agency: identifies the model, question and definitions that marked them. */
  classifierVersion?: string;
}

/** Records engagement in the background; a failure is logged and never reaches the caller. */
export interface AgencyEventRecorder {
  event(input: AgencyEventInput): void;
}

export function createAgencyEventRecorder({
  recordAgencyEvent,
}: {
  recordAgencyEvent: (input: AgencyEventInput) => Promise<void>;
}): AgencyEventRecorder {
  return {
    event(input) {
      recordAgencyEvent(input).catch((error: unknown) => {
        logger.warn('[agency] Could not record an engagement event', {
          eventType: input.type,
          ...getSafeErrorMetadata(error),
        });
      });
    },
  };
}

/** What the classifier records, which the analytics store keeps as `agency.*` spans too. */
const CLASSIFIER_EVENTS: ReadonlySet<AgencyEventType> = new Set<AgencyEventType>([
  'support_classified',
  'topic_classified',
  'signal_classified',
  'signals_checked',
]);

/**
 * Also sends the classifier's events to the OpenTelemetry collector, for HyperDX, when the browser
 * telemetry proxy is configured. They hold IDs and labels only. A failure is logged and goes no
 * further: the event is still recorded.
 */
export function withClassifierSpans(
  recorder: AgencyEventRecorder,
  send: SendOtlpSpan | undefined = getDefaultOtlpSpanSender(),
): AgencyEventRecorder {
  if (send == null) {
    return recorder;
  }
  return {
    event(input) {
      recorder.event(input);
      if (!CLASSIFIER_EVENTS.has(input.type)) {
        return;
      }
      const { userId, conversationId, messageId, detail, classifierVersion } = input;
      send({
        name: `agency.${input.type}`,
        scope: 'agency',
        attributes: { userId, conversationId, messageId, label: detail, classifierVersion },
      }).catch((error: unknown) => {
        logger.warn('[agency] Could not send a classifier span', getSafeErrorMetadata(error));
      });
    },
  };
}

type AskQuestion = {
  id?: unknown;
  options?: Array<{ label?: unknown; value?: unknown }>;
};

/** The longest option label kept as an event's detail. */
const DETAIL_MAX = 280;

/**
 * The engagement events a learner's answer to `ask_user_question` amounts to:
 * - a `goal_check` question is offered, then resolved with the outcome the learner chose;
 * - any other question with options is offered, and selected when the answer is one of them.
 * A free-form answer counts as offered but not selected.
 */
export function answerEvents(
  questions: readonly AskQuestion[],
  answers: Record<string, unknown>,
): Array<Pick<AgencyEventInput, 'type' | 'detail'>> {
  const events: Array<Pick<AgencyEventInput, 'type' | 'detail'>> = [];
  for (const question of questions) {
    const id = typeof question.id === 'string' ? question.id : '';
    const answer = answers[id];
    const options = Array.isArray(question.options) ? question.options : [];
    if (id === AGENCY_QUESTION_IDS.goalCheck) {
      events.push({ type: 'goal_check_offered' });
      if (typeof answer === 'string' && isGoalCheckOutcome(answer)) {
        events.push({ type: 'goal_check_resolved', detail: answer });
      }
      continue;
    }
    if (options.length === 0) {
      continue;
    }
    events.push({ type: 'options_offered' });
    const chosen = options.find((option) => option.value === answer);
    if (chosen != null) {
      const label = typeof chosen.label === 'string' ? chosen.label : String(chosen.value);
      events.push({ type: 'option_selected', detail: label.slice(0, DETAIL_MAX) });
    }
  }
  return events;
}

type PendingAsk = {
  questions: AskQuestion[];
  responseMessageId?: string;
};

type GenerationJob = {
  metadata?: {
    responseMessageId?: string;
    pendingAction?: { payload?: { type?: string; questions?: unknown } };
  };
} | null;

/** The question batch a paused generation is waiting on, if it is an `ask_user_question`. */
export function pendingAskOf(job: GenerationJob | undefined): PendingAsk | null {
  const payload = job?.metadata?.pendingAction?.payload;
  if (payload?.type !== 'ask_user_question' || !Array.isArray(payload.questions)) {
    return null;
  }
  return {
    questions: payload.questions as AskQuestion[],
    responseMessageId: job?.metadata?.responseMessageId,
  };
}

type AnswerRequest = Request & {
  config?: { agency?: TAgencyConfig };
  user?: { id?: string };
  body: { conversationId?: unknown; answers?: unknown };
};

/**
 * Resume-route middleware that records how a learner answered the model's options once the
 * resume is accepted. The paused question batch comes from the generation job (`getJob`),
 * since the request carries only the answers.
 */
export function createAgencyAnswerRecorder({
  getJob,
  record,
}: {
  getJob: (streamId: string) => Promise<GenerationJob | undefined>;
  record: AgencyEventRecorder;
}): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async function recordAgencyAnswer(req, res, next) {
    const request = req as AnswerRequest;
    const userId = request.user?.id;
    const { conversationId, answers } = request.body ?? {};
    if (
      !request.config?.agency?.recap ||
      !userId ||
      typeof conversationId !== 'string' ||
      answers == null ||
      typeof answers !== 'object' ||
      Array.isArray(answers)
    ) {
      return next();
    }
    let pending: PendingAsk | null = null;
    try {
      pending = pendingAskOf(await getJob(conversationId));
    } catch (error) {
      logger.warn('[agency] Could not read the pending question', getSafeErrorMetadata(error));
    }
    if (pending?.questions?.length) {
      const { questions, responseMessageId } = pending;
      res.on('finish', () => {
        if (res.statusCode >= 300) {
          return;
        }
        for (const event of answerEvents(questions, answers as Record<string, unknown>)) {
          record.event({
            userId,
            conversationId,
            ...(responseMessageId ? { messageId: responseMessageId } : {}),
            ...event,
          });
        }
      });
    }
    return next();
  };
}
