import { logger } from '@librechat/data-schemas';
import type { TSafeguardingErrorInfo } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { SafeguardingAssessment, SafeguardingSource } from './assess';
import type { SafeguardedModelOutput } from './output';
import type { SafeguardingParticipant } from './alert';
import type { SafeguardingEvent } from './record';
import { sendSafeguardingScore, traceIdForMessage } from '~/langfuse';
import { getSafeguardingReporter } from './record';
import { getSafeguardingScreener } from './screen';
import { assessModelOutput } from './output';
import { blockedReasons } from './assess';

type SafeguardingConfigHolder = Partial<AppConfig> | undefined;

/** The pseudonymous IDs an alert and log name a participant by: never their name or email. */
export function participantOf(user: {
  id?: string;
  _id?: { toString(): string } | string;
  openidId?: string;
}): SafeguardingParticipant {
  return {
    userId: user.id ?? (user._id == null ? 'unknown' : String(user._id)),
    ...(user.openidId ? { studyId: user.openidId } : {}),
  };
}

/** Content that may go on, or why not, as the `info` of a `safeguarding` error. */
export type SafeguardingCheck =
  | { readonly ok: true; readonly assessment: SafeguardingAssessment }
  | { readonly ok: false; readonly info: TSafeguardingErrorInfo };

const ALLOWED: SafeguardingCheck = { ok: true, assessment: { severity: 'none', detections: [] } };

/** Marks the turn's Langfuse trace for review; failures are logged, never thrown. */
function scoreTrace(
  appConfig: SafeguardingConfigHolder,
  traceMessageId: string | undefined,
  source: SafeguardingSource,
  assessment: SafeguardingAssessment,
): void {
  if (!traceMessageId || assessment.severity === 'none') {
    return;
  }
  sendSafeguardingScore({
    traceId: traceIdForMessage(traceMessageId),
    severity: assessment.severity,
    source,
    filters: assessment.detections.map(({ type, name }) => `${type}:${name}`),
    appConfig: appConfig as AppConfig | undefined,
  }).catch((error: unknown) => {
    logger.error('[safeguarding] Could not score the trace', { traceMessageId, error });
  });
}

/**
 * Screens what a participant wrote or uploaded before it goes on, with `safeguarding`'s
 * guardrail: a prompt, an answer to the model's question, or an upload's text. A detection at
 * `flag` is recorded and the content goes on; at `block` it is recorded, the leads are
 * alerted and the content is refused. When the guardrail cannot be reached the content is
 * refused (`onError: refuse`) or let through unscreened (`allow`). With no `safeguarding`
 * config everything goes on. `traceMessageId` is the response whose Langfuse trace the
 * content belongs to, scored when the content goes on.
 */
export async function screenForSafeguarding({
  appConfig,
  text,
  event,
  traceMessageId,
}: {
  appConfig: SafeguardingConfigHolder;
  text: string;
  event: SafeguardingEvent;
  traceMessageId?: string;
}): Promise<SafeguardingCheck> {
  const config = appConfig?.safeguarding;
  if (config == null || !text.trim()) {
    return ALLOWED;
  }
  let assessment: SafeguardingAssessment;
  try {
    assessment = await getSafeguardingScreener(config).screen(text);
  } catch (error) {
    logger.error('[safeguarding] Could not screen content', {
      source: event.source,
      userId: event.participant.userId,
      error,
    });
    return config.onError === 'allow'
      ? ALLOWED
      : { ok: false, info: { source: event.source, reasons: [], unavailable: true } };
  }
  await getSafeguardingReporter(config).report(assessment, event);
  if (assessment.severity === 'block') {
    return { ok: false, info: { source: event.source, reasons: blockedReasons(assessment) } };
  }
  scoreTrace(appConfig, traceMessageId, event.source, assessment);
  return { ok: true, assessment };
}

/**
 * Reads what the guardrail on a model call found in its response (`assessModelOutput`) and
 * returns the `info` of a `safeguarding` error when the response was blocked. Recording and
 * alerting run in the background, so the stream is not held up. Call it before
 * `reportGuardrailOutputDetections`, which deletes the trace.
 */
export function checkModelOutput({
  appConfig,
  output,
  event,
}: {
  appConfig: SafeguardingConfigHolder;
  output: SafeguardedModelOutput | undefined;
  event: Omit<SafeguardingEvent, 'source'>;
}): TSafeguardingErrorInfo | undefined {
  const config = appConfig?.safeguarding;
  if (config == null) {
    return undefined;
  }
  const assessment = assessModelOutput(output, config);
  if (assessment.severity === 'none') {
    return undefined;
  }
  getSafeguardingReporter(config)
    .report(assessment, { ...event, source: 'response' })
    .catch((error: unknown) => {
      logger.error('[safeguarding] Could not record a response detection', { error });
    });
  scoreTrace(appConfig, event.messageId, 'response', assessment);
  return assessment.severity === 'block'
    ? { source: 'response', reasons: blockedReasons(assessment) }
    : undefined;
}
