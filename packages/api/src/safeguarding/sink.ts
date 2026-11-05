import { randomBytes } from 'crypto';
import { logger } from '@librechat/data-schemas';
import { isRumProxyEnabled, resolveRumProxyTarget } from '~/rum/proxy';
import { getSafeErrorMetadata } from '~/utils/errors';

/** A detection as the study keeps it: IDs and filters, never the content. */
export interface SafeguardingRecord {
  readonly severity: 'flag' | 'block';
  readonly source: string;
  readonly userId: string;
  readonly studyId?: string;
  readonly conversationId?: string;
  readonly messageId?: string;
  readonly fileId?: string;
  /** `type:name[:confidence]` per filter, comma-separated. */
  readonly filters: string;
}

/** Keeps detection records for the length of the study. */
export interface SafeguardingSink {
  write(record: SafeguardingRecord, at?: Date): Promise<void>;
}

type OtlpAttribute = { key: string; value: { stringValue: string } };

/** An OTLP/JSON trace export request holding one span. */
export interface OtlpSpanRequest {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: string };
      spans: Array<{
        traceId: string;
        spanId: string;
        name: string;
        kind: number;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: OtlpAttribute[];
      }>;
    }>;
  }>;
}

/** A zero-length span for the analytics store: names and IDs, never content. */
export interface OtlpSpan {
  name: string;
  scope: string;
  attributes: Readonly<Record<string, unknown>>;
  at?: Date;
}

/** Sends one span to the OpenTelemetry collector. */
export type SendOtlpSpan = (span: OtlpSpan) => Promise<void>;

function toOtlpRequest(
  { name, scope, attributes, at = new Date() }: OtlpSpan,
  serviceName: string,
): OtlpSpanRequest {
  const time = `${at.getTime()}000000`;
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: scope },
            spans: [
              {
                traceId: randomBytes(16).toString('hex'),
                spanId: randomBytes(8).toString('hex'),
                name,
                kind: 1,
                startTimeUnixNano: time,
                endTimeUnixNano: time,
                attributes: Object.entries(attributes)
                  .filter(([, value]) => typeof value === 'string' && value !== '')
                  .map(([key, value]) => ({ key, value: { stringValue: value as string } })),
              },
            ],
          },
        ],
      },
    ],
  };
}

const safeguardingSpan = (record: SafeguardingRecord, at?: Date): OtlpSpan => ({
  name: `safeguarding.${record.severity}`,
  scope: 'safeguarding',
  attributes: { ...record },
  at,
});

/** OTLP/JSON for one zero-length span, as the collector's `/v1/traces` takes it. */
export function toOtlpSpan(
  record: SafeguardingRecord,
  { serviceName, at }: { serviceName: string; at?: Date },
): OtlpSpanRequest {
  return toOtlpRequest(safeguardingSpan(record, at), serviceName);
}

/** Posts spans to the collector at `target`. Throws when it does not accept one. */
export function createOtlpSpanSender({
  target,
  authorization,
  serviceName,
  fetchImpl = fetch,
}: {
  target: string;
  authorization?: string;
  serviceName: string;
  fetchImpl?: typeof fetch;
}): SendOtlpSpan {
  return async (span) => {
    const response = await fetchImpl(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(toOtlpRequest(span, serviceName)),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`collector answered ${response.status}`);
    }
  };
}

/**
 * Sends each record to the OpenTelemetry collector as a `safeguarding.flag` or
 * `safeguarding.block` span, through the same target and credentials as the browser
 * telemetry proxy (`RUM_PROXY_TARGET_URL`, `RUM_PROXY_AUTHORIZATION`). The analytics store
 * keeps these spans for the study, beside the browser's named actions.
 */
export function createOtlpSafeguardingSink(
  options: Parameters<typeof createOtlpSpanSender>[0],
): SafeguardingSink {
  const send = createOtlpSpanSender(options);
  return { write: (record, at) => send(safeguardingSpan(record, at)) };
}

/** Sends to the collector when the browser telemetry proxy is configured, else undefined. */
export function getDefaultOtlpSpanSender(
  env: NodeJS.ProcessEnv = process.env,
): SendOtlpSpan | undefined {
  const target = isRumProxyEnabled() ? resolveRumProxyTarget('/v1/traces') : undefined;
  if (target == null) {
    return undefined;
  }
  return createOtlpSpanSender({
    target,
    authorization: env.RUM_PROXY_AUTHORIZATION?.trim() || undefined,
    serviceName: `${env.RUM_SERVICE_NAME?.trim() || 'librechat'}-api`,
  });
}

/**
 * Records a call that processed user input as a `processing.*` span, in the background, when the
 * browser telemetry proxy is configured: what happened and how long it took, never the content.
 * Numbers are sent as text, as every span attribute here is. A failure is only logged.
 */
export function recordProcessing(
  operation: string,
  attributes: Readonly<Record<string, string | number | undefined>>,
  send: SendOtlpSpan | undefined = getDefaultOtlpSpanSender(),
): void {
  send?.({
    name: `processing.${operation}`,
    scope: 'processing',
    attributes: Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [
        key,
        typeof value === 'number' ? String(value) : value,
      ]),
    ),
  }).catch((error: unknown) => {
    logger.warn('[processing] Could not send a span', {
      operation,
      ...getSafeErrorMetadata(error),
    });
  });
}

/** The collector sink when the browser telemetry proxy is configured, else none. */
export function getDefaultSafeguardingSink(
  env: NodeJS.ProcessEnv = process.env,
): SafeguardingSink | undefined {
  const send = getDefaultOtlpSpanSender(env);
  return send != null ? { write: (record, at) => send(safeguardingSpan(record, at)) } : undefined;
}
