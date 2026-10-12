import type {
  GuardrailPolicyAssessment,
  SafeguardingAssessment,
  SafeguardingLevels,
} from './assess';
import { assessGuardrail, NO_DETECTIONS } from './assess';

/** The reason for a response the model's own safety filter stopped. */
export const MODEL_FILTER = 'MODEL_FILTER';

type GuardrailTrace = {
  guardrail?: {
    outputAssessments?: Record<string, GuardrailPolicyAssessment[] | undefined>;
  };
};

/** A model call's output, as the Bedrock provider leaves it at the end of a call. */
export interface SafeguardedModelOutput {
  response_metadata?: {
    /** Where a streamed Converse call puts the stream's final metadata event. */
    metadata?: { trace?: GuardrailTrace };
    /** Where a Converse call that is not streamed puts it. */
    trace?: GuardrailTrace;
    messageStop?: { stopReason?: string };
    stopReason?: string;
  };
}

/**
 * Reads what the guardrail on a Bedrock model call (`endpoints.bedrock.guardrailConfig`)
 * found in the model's response. The guardrail blocks at the `block` levels itself
 * (`guardrail_intervened`), so a response it stopped is blocked even when its trace names no
 * filter; below that, `levels` decide what is flagged, which needs `trace: enabled_full` so
 * the trace includes the filters that did not block. A response the model's own safety filter
 * stopped (`content_filtered`, as Amazon Nova does) is blocked too, as `MODEL_FILTER`: the
 * guardrail never saw what it held back. Call it before `reportGuardrailOutputDetections`,
 * which deletes the trace.
 */
export function assessModelOutput(
  output: SafeguardedModelOutput | undefined,
  levels: SafeguardingLevels,
): SafeguardingAssessment {
  const metadata = output?.response_metadata;
  if (metadata == null) {
    return NO_DETECTIONS;
  }
  const trace = metadata.metadata?.trace ?? metadata.trace;
  const assessed = assessGuardrail(
    Object.values(trace?.guardrail?.outputAssessments ?? {}).flatMap((list) => list ?? []),
    levels,
  );
  const stopReason = metadata.messageStop?.stopReason ?? metadata.stopReason;
  if (stopReason === 'content_filtered') {
    return {
      severity: 'block',
      detections: [
        ...assessed.detections,
        { type: 'model', name: MODEL_FILTER, severity: 'block' },
      ],
    };
  }
  if (stopReason === 'guardrail_intervened' && assessed.severity !== 'block') {
    return { severity: 'block', detections: assessed.detections };
  }
  return assessed;
}
