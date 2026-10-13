import { logger } from '@librechat/data-schemas';

type Detection = { type?: string; name?: string; detected?: boolean };

type OutputAssessment = {
  sensitiveInformationPolicy?: { piiEntities?: Detection[]; regexes?: Detection[] };
};

type GuardrailTrace = {
  guardrail?: { outputAssessments?: Record<string, OutputAssessment[] | undefined> };
};

type ModelOutput = {
  response_metadata?: {
    /** Where a streamed Converse call puts the stream's final metadata event. */
    metadata?: { trace?: GuardrailTrace };
    /** Where a Converse call that is not streamed puts it. */
    trace?: GuardrailTrace;
  };
};

/** The PII types and custom pattern names the guardrail detected in a model's output. */
function detectedTypes(trace: GuardrailTrace | undefined): string[] {
  const found = new Set<string>();
  for (const assessments of Object.values(trace?.guardrail?.outputAssessments ?? {})) {
    for (const assessment of assessments ?? []) {
      const policy = assessment.sensitiveInformationPolicy;
      for (const { type, detected } of policy?.piiEntities ?? []) {
        if (type != null && detected !== false) {
          found.add(type);
        }
      }
      for (const { name, detected } of policy?.regexes ?? []) {
        if (name != null && detected !== false) {
          found.add(name);
        }
      }
    }
  }
  return [...found];
}

/**
 * Reads what the guardrail on a Bedrock model call (`endpoints.bedrock.guardrailConfig`, with
 * its trace on) detected in the model's output, logs the identifier types with the message's
 * IDs, never the text, and deletes the trace from the output, since it carries the matched
 * values. The output itself is left as the model wrote it. Returns the types found.
 */
export function reportGuardrailOutputDetections(
  output: ModelOutput | undefined,
  ids: { messageId?: string; conversationId?: string },
): string[] {
  const responseMetadata = output?.response_metadata;
  if (responseMetadata == null) {
    return [];
  }
  const trace = responseMetadata.metadata?.trace ?? responseMetadata.trace;
  if (trace == null) {
    return [];
  }
  const identifiers = detectedTypes(trace);
  delete responseMetadata.trace;
  if (responseMetadata.metadata != null) {
    delete responseMetadata.metadata.trace;
  }
  if (identifiers.length > 0) {
    logger.warn('[piiMasking] A model response contains personal identifiers', {
      ...ids,
      identifiers,
    });
  }
  return identifiers;
}
