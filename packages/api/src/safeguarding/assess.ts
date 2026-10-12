import { SAFEGUARDING_CONTENT_FILTERS } from 'librechat-data-provider';
import type {
  SafeguardingConfidence,
  SafeguardingContentFilter,
  TSafeguarding,
  TSafeguardingReason,
} from 'librechat-data-provider';

/** Where screened content came from. */
export type SafeguardingSource = 'prompt' | 'answer' | 'upload' | 'response';

export type SafeguardingSeverity = 'none' | 'flag' | 'block';

/** One filter's finding: its kind, category or name and confidence, never the matched text. */
export interface SafeguardingDetection {
  readonly type: 'content' | 'topic' | 'word' | 'model';
  /**
   * A content filter category, a denied topic's name, the word list (`custom`, `PROFANITY`), or
   * `MODEL_FILTER` for a response the model's own safety filter stopped.
   */
  readonly name: string;
  readonly confidence?: string;
  readonly severity: Exclude<SafeguardingSeverity, 'none'>;
}

export interface SafeguardingAssessment {
  readonly severity: SafeguardingSeverity;
  readonly detections: SafeguardingDetection[];
}

export type SafeguardingLevels = Pick<TSafeguarding, 'flag' | 'block' | 'topics' | 'words'>;

/** The parts of a guardrail assessment, from ApplyGuardrail or a model call's trace, read here. */
export interface GuardrailPolicyAssessment {
  contentPolicy?: {
    filters?: Array<{ type?: string; confidence?: string; action?: string; detected?: boolean }>;
  };
  topicPolicy?: { topics?: Array<{ name?: string; action?: string; detected?: boolean }> };
  wordPolicy?: {
    customWords?: Array<{ action?: string; detected?: boolean }>;
    managedWordLists?: Array<{ type?: string; action?: string; detected?: boolean }>;
  };
}

export const NO_DETECTIONS: SafeguardingAssessment = { severity: 'none', detections: [] };

const RANK: Record<string, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
const SEVERITY_RANK: Record<SafeguardingSeverity, number> = { none: 0, flag: 1, block: 2 };

const isContentFilter = (type: string): type is SafeguardingContentFilter =>
  (SAFEGUARDING_CONTENT_FILTERS as readonly string[]).includes(type);

/** Whether `confidence` reaches `level`; `OFF` is never reached. */
function reaches(confidence: string | undefined, level: SafeguardingConfidence): boolean {
  if (level === 'OFF') {
    return false;
  }
  return (RANK[confidence ?? 'NONE'] ?? 0) >= RANK[level];
}

/** A filter's own verdict: Bedrock blocked it, so it was blocked whatever the levels say. */
const blocked = (action: string | undefined) => action === 'BLOCKED';

/**
 * Turns guardrail assessments into safeguarding detections. A content filter is blocked
 * when Bedrock blocked it or its confidence reaches `block`, and flagged when it reaches
 * `flag`; a detected denied topic takes its `topics` action (`flag` when unlisted), or
 * `block` when Bedrock blocked it; a word list match is flagged unless `words` is `off`.
 * Each filter appears once, at its most severe.
 */
export function assessGuardrail(
  assessments: Iterable<GuardrailPolicyAssessment>,
  levels: SafeguardingLevels,
): SafeguardingAssessment {
  const found = new Map<string, SafeguardingDetection>();
  const add = (detection: SafeguardingDetection) => {
    const key = `${detection.type}:${detection.name}`;
    const existing = found.get(key);
    if (
      existing == null ||
      SEVERITY_RANK[detection.severity] > SEVERITY_RANK[existing.severity] ||
      (detection.severity === existing.severity &&
        (RANK[detection.confidence ?? 'NONE'] ?? 0) > (RANK[existing.confidence ?? 'NONE'] ?? 0))
    ) {
      found.set(key, detection);
    }
  };

  for (const assessment of assessments) {
    for (const { type, confidence, action } of assessment.contentPolicy?.filters ?? []) {
      if (type == null || !isContentFilter(type)) {
        continue;
      }
      if (blocked(action) || reaches(confidence, levels.block[type])) {
        add({ type: 'content', name: type, confidence, severity: 'block' });
      } else if (reaches(confidence, levels.flag[type])) {
        add({ type: 'content', name: type, confidence, severity: 'flag' });
      }
    }
    for (const { name, action, detected } of assessment.topicPolicy?.topics ?? []) {
      if (name == null || (detected === false && !blocked(action))) {
        continue;
      }
      add({
        type: 'topic',
        name,
        severity: blocked(action) ? 'block' : (levels.topics[name] ?? 'flag'),
      });
    }
    if (levels.words === 'off') {
      continue;
    }
    const words = assessment.wordPolicy;
    if (words?.customWords?.some(({ detected }) => detected !== false)) {
      add({ type: 'word', name: 'custom', severity: 'flag' });
    }
    for (const { type, detected } of words?.managedWordLists ?? []) {
      if (detected !== false) {
        add({ type: 'word', name: type ?? 'managed', severity: 'flag' });
      }
    }
  }

  const detections = [...found.values()];
  const severity = detections.reduce<SafeguardingSeverity>(
    (worst, { severity: next }) => (SEVERITY_RANK[next] > SEVERITY_RANK[worst] ? next : worst),
    'none',
  );
  return { severity, detections };
}

/** Combines assessments of parts of the same content, such as an upload's chunks. */
export function mergeAssessments(parts: SafeguardingAssessment[]): SafeguardingAssessment {
  const detections = new Map<string, SafeguardingDetection>();
  let severity: SafeguardingSeverity = 'none';
  for (const part of parts) {
    if (SEVERITY_RANK[part.severity] > SEVERITY_RANK[severity]) {
      severity = part.severity;
    }
    for (const detection of part.detections) {
      const key = `${detection.type}:${detection.name}`;
      const existing = detections.get(key);
      if (
        existing == null ||
        SEVERITY_RANK[detection.severity] > SEVERITY_RANK[existing.severity]
      ) {
        detections.set(key, detection);
      }
    }
  }
  return { severity, detections: [...detections.values()] };
}

/** What a participant is told content was blocked for: the blocking filters only. */
export function blockedReasons(assessment: SafeguardingAssessment): TSafeguardingReason[] {
  return assessment.detections
    .filter(
      (detection): detection is SafeguardingDetection & { type: 'content' | 'topic' | 'model' } =>
        detection.severity === 'block' && detection.type !== 'word',
    )
    .map(({ type, name }) => ({ type, name }));
}
