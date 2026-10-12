import { randomBytes } from 'crypto';
import { isRumProxyEnabled, resolveRumProxyTarget } from '~/rum/proxy';

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

/** OTLP/JSON for one zero-length span, as the collector's `/v1/traces` takes it. */
export function toOtlpSpan(
  record: SafeguardingRecord,
  { serviceName, at = new Date() }: { serviceName: string; at?: Date },
): OtlpSpanRequest {
  const time = `${at.getTime()}000000`;
  const attributes: OtlpAttribute[] = Object.entries(record)
    .filter(([, value]) => typeof value === 'string' && value !== '')
    .map(([key, value]) => ({ key, value: { stringValue: value as string } }));
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: 'safeguarding' },
            spans: [
              {
                traceId: randomBytes(16).toString('hex'),
                spanId: randomBytes(8).toString('hex'),
                name: `safeguarding.${record.severity}`,
                kind: 1,
                startTimeUnixNano: time,
                endTimeUnixNano: time,
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Sends each record to the OpenTelemetry collector as a `safeguarding.flag` or
 * `safeguarding.block` span, through the same target and credentials as the browser
 * telemetry proxy (`RUM_PROXY_TARGET_URL`, `RUM_PROXY_AUTHORIZATION`). The analytics store
 * keeps these spans for the study, beside the browser's named actions.
 */
export function createOtlpSafeguardingSink({
  target,
  authorization,
  serviceName,
  fetchImpl = fetch,
}: {
  target: string;
  authorization?: string;
  serviceName: string;
  fetchImpl?: typeof fetch;
}): SafeguardingSink {
  return {
    async write(record, at) {
      const response = await fetchImpl(target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(toOtlpSpan(record, { serviceName, at })),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`collector answered ${response.status}`);
      }
    },
  };
}

/** The collector sink when the browser telemetry proxy is configured, else none. */
export function getDefaultSafeguardingSink(
  env: NodeJS.ProcessEnv = process.env,
): SafeguardingSink | undefined {
  const target = isRumProxyEnabled() ? resolveRumProxyTarget('/v1/traces') : undefined;
  if (target == null) {
    return undefined;
  }
  return createOtlpSafeguardingSink({
    target,
    authorization: env.RUM_PROXY_AUTHORIZATION?.trim() || undefined,
    serviceName: `${env.RUM_SERVICE_NAME?.trim() || 'librechat'}-api`,
  });
}
