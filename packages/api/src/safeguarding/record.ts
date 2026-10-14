import { logger } from '@librechat/data-schemas';
import { extractEnvVariable } from 'librechat-data-provider';
import type { TSafeguarding } from 'librechat-data-provider';
import type { SafeguardingAlertPublisher, SafeguardingParticipant } from './alert';
import type { SafeguardingAssessment, SafeguardingSource } from './assess';
import type { SafeguardingSink } from './sink';
import { createSnsAlertPublisher, formatSafeguardingAlert, getSnsClient } from './alert';
import { getDefaultSafeguardingSink } from './sink';

/** Where screened content was, for the log and the alert; IDs only. */
export interface SafeguardingEvent {
  readonly source: SafeguardingSource;
  readonly participant: SafeguardingParticipant;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly fileId?: string;
}

export interface SafeguardingReporter {
  /** Records a detection. Never throws: a failed alert is logged as an error. */
  report(assessment: SafeguardingAssessment, event: SafeguardingEvent): Promise<void>;
}

/** `type:name[:confidence]` per detection, for a record that is searched as text. */
export const describeFilters = (assessment: SafeguardingAssessment): string =>
  assessment.detections
    .map(({ type, name, confidence }) => [type, name, confidence].filter(Boolean).join(':'))
    .join(',');

/**
 * Records every flagged or blocked detection: a `[safeguarding]` log line with the filters
 * and IDs, never the content; a record in `sink`, which the study keeps; and, for blocked
 * content, an alert through `alerts`.
 */
export function createSafeguardingReporter({
  alerts,
  sink,
}: {
  alerts?: SafeguardingAlertPublisher;
  sink?: SafeguardingSink;
}): SafeguardingReporter {
  return {
    async report(assessment, event) {
      if (assessment.severity === 'none') {
        return;
      }
      const { participant, ...ids } = event;
      const filters = describeFilters(assessment);
      logger.warn(
        assessment.severity === 'block'
          ? '[safeguarding] Content blocked'
          : '[safeguarding] Content flagged',
        {
          ...ids,
          userId: participant.userId,
          studyId: participant.studyId,
          severity: assessment.severity,
          filters,
        },
      );
      const tasks: Promise<void>[] = [];
      if (sink) {
        tasks.push(
          sink
            .write({
              ...ids,
              severity: assessment.severity,
              userId: participant.userId,
              ...(participant.studyId ? { studyId: participant.studyId } : {}),
              filters,
            })
            .catch((error: unknown) => {
              logger.error('[safeguarding] Could not keep a detection record', { ...ids, error });
            }),
        );
      }
      if (alerts && assessment.severity === 'block') {
        const alert = formatSafeguardingAlert({
          participant,
          source: event.source,
          detections: assessment.detections,
        });
        tasks.push(
          alerts.publish(alert).catch((error: unknown) => {
            logger.error('[safeguarding] Could not send an alert', { ...ids, error });
          }),
        );
      }
      await Promise.all(tasks);
    },
  };
}

const reporters = new WeakMap<TSafeguarding, SafeguardingReporter>();

/**
 * The reporter for `config`, shared by every request with the same config: alerts go to
 * `alerts.topicArn` (`${ENV}` resolved) through SNS in `AWS_REGION`, and records to the
 * collector when the browser telemetry proxy is configured (`getDefaultSafeguardingSink`).
 */
export function getSafeguardingReporter(
  config: TSafeguarding,
  env: NodeJS.ProcessEnv = process.env,
): SafeguardingReporter {
  let reporter = reporters.get(config);
  if (reporter != null) {
    return reporter;
  }
  const topicArn = config.alerts ? extractEnvVariable(config.alerts.topicArn) : undefined;
  if (config.alerts && (!topicArn || /^\$\{.+\}$/.test(topicArn))) {
    throw new Error('safeguarding.alerts is configured, but its topicArn is not set');
  }
  reporter = createSafeguardingReporter({
    alerts: topicArn
      ? createSnsAlertPublisher({ client: getSnsClient(env.AWS_REGION), topicArn })
      : undefined,
    sink: getDefaultSafeguardingSink(env),
  });
  reporters.set(config, reporter);
  return reporter;
}
