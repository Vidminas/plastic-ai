import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { SafeguardingDetection, SafeguardingSource } from './assess';

/** The participant that an alert is about. Never their name. */
export interface SafeguardingParticipant {
  /** The app's user ID. */
  readonly userId: string;
  /** The email address of the account. The research team sets up each account. */
  readonly email?: string;
}

export interface SafeguardingAlert {
  readonly subject: string;
  readonly message: string;
}

/** Sends an alert to the Designated Safeguarding Leads. */
export interface SafeguardingAlertPublisher {
  publish(alert: SafeguardingAlert): Promise<void>;
}

const SOURCE_LABELS: Record<SafeguardingSource, string> = {
  prompt: 'a message the participant wrote',
  answer: "the participant's answer to the assistant's question",
  upload: 'a file the participant uploaded',
  response: "the assistant's response",
  goal: 'a goal the participant set for a conversation',
  intentions: "the participant's long-term learning intentions",
  reflection: 'a reflection the participant wrote on the recap',
  instructions: 'the hidden instructions the participant wrote for the assistant',
};

const TYPE_LABELS: Record<SafeguardingDetection['type'], string> = {
  content: 'content filter',
  topic: 'denied topic',
  word: 'word list',
  model: "the model's own safety filter",
};

const describe = ({ type, name, confidence }: SafeguardingDetection): string => {
  if (type === 'model') {
    return TYPE_LABELS.model;
  }
  return `${TYPE_LABELS[type]}: ${name}${confidence ? ` (${confidence} confidence)` : ''}`;
};

/**
 * The alert for blocked content, as plain text for email: the email and app user ID of the
 * participant, what was screened, the filters and the severity. Never the content.
 */
export function formatSafeguardingAlert({
  participant,
  source,
  detections,
  at = new Date(),
  app = 'plastic-ai',
}: {
  participant: SafeguardingParticipant;
  source: SafeguardingSource;
  detections: readonly SafeguardingDetection[];
  at?: Date;
  app?: string;
}): SafeguardingAlert {
  const blocked = detections.filter(({ severity }) => severity === 'block');
  const shown = blocked.length > 0 ? blocked : detections;
  return {
    subject: `Safeguarding alert (${app}): content blocked`,
    message: [
      `Safeguarding alert (${app})`,
      '',
      `Participant: ${participant.email ?? 'unknown email'} (app user ${participant.userId})`,
      `Screened: ${SOURCE_LABELS[source]}`,
      `Triggered: ${shown.length > 0 ? shown.map(describe).join('; ') : 'the model guardrail (no filter named)'}`,
      'Severity: strong (content blocked)',
      `Time: ${at.toISOString()}`,
    ].join('\n'),
  };
}

/** Publishes alerts to an SNS topic, which emails the leads and logs to its SQS queue. */
export function createSnsAlertPublisher({
  client,
  topicArn,
}: {
  client: Pick<SNSClient, 'send'>;
  topicArn: string;
}): SafeguardingAlertPublisher {
  return {
    async publish({ subject, message }) {
      await client.send(
        new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }),
      );
    },
  };
}

const snsClients = new Map<string, SNSClient>();

/** An SNS client per region, shared by every request. */
export function getSnsClient(region: string | undefined): SNSClient {
  const key = region ?? '';
  let client = snsClients.get(key);
  if (client == null) {
    client = new SNSClient({ region, retryMode: 'adaptive', maxAttempts: 5 });
    snsClients.set(key, client);
  }
  return client;
}
