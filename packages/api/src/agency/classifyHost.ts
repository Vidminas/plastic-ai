import { initializeModel } from '@librechat/agents';
import { EModelEndpoint } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { ClientOptions } from '@librechat/agents';
import type { Request } from 'express';
import type { CollectedMetadataEntry } from '~/agents/activityLabels/host';
import type { EndpointDbMethods, ServerRequest } from '~/types';
import type { AgencyClassifierDeps } from './classify';
import type { RecordUsageDeps } from '~/agents/usage';
import {
  LABEL_MAX_OUTPUT_TOKENS,
  resolveActivityLabelModel,
  mapCollectedMetadataToUsage,
} from '~/agents/activityLabels/host';
import { getBalanceConfig, getTransactionsConfig } from '~/app/config';
import { extractText } from '~/agents/activityLabels/runtime';
import { recordCollectedUsage } from '~/agents/usage';

/** How long a label may take before it is given up. */
const CLASSIFIER_TIMEOUT_MS = 20_000;

type ModelReply = { content?: unknown; usage_metadata?: CollectedMetadataEntry['usage_metadata'] };

/**
 * Calls `agency.classifier`'s model the way activity labels call theirs: credentials and
 * options from its endpoint, without the primary generation's settings, and a small output
 * cap. Its usage is charged to the learner like a title's.
 */
export function createAgencyClassifierInvoker({
  db,
  usage,
}: {
  db: EndpointDbMethods;
  usage: RecordUsageDeps;
}): AgencyClassifierDeps['invoke'] {
  return async (req: Request, prompt, ids) => {
    const request = req as ServerRequest & { config?: AppConfig };
    const classifier = request.config?.agency?.classifier;
    const user = (request.user as { id?: string } | undefined)?.id;
    if (classifier == null || user == null) {
      throw new Error('No classifier configured');
    }
    const llm = await resolveActivityLabelModel({
      req: request,
      agent: {
        endpoint: classifier.endpoint,
        model: classifier.model,
        model_parameters: { model: classifier.model },
      },
      ids,
      db,
      explicitModel: classifier.model,
      /** Claude's newer models think unless told not to, which could spend the small output cap
       *  before any label is written. Passed here so a Bedrock fallback keeps both limits too. */
      modelParameters:
        classifier.endpoint === EModelEndpoint.bedrock
          ? { thinking: false, maxOutputTokens: LABEL_MAX_OUTPUT_TOKENS }
          : undefined,
    });
    const model = initializeModel({
      provider: llm.provider,
      clientOptions: { ...llm.clientOptions, streaming: false } as ClientOptions,
    }) as { invoke: (input: string, config?: object) => Promise<ModelReply> };
    const reply = await model.invoke(prompt, {
      signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS),
    });
    const [tokens] = mapCollectedMetadataToUsage([{ usage_metadata: reply.usage_metadata }]);
    if (tokens.input_tokens != null || tokens.output_tokens != null) {
      await recordCollectedUsage(usage, {
        user,
        conversationId: ids.conversationId,
        collectedUsage: [{ ...tokens, provider: llm.provider }],
        model: classifier.model,
        context: 'agency-classifier',
        messageId: ids.messageId,
        balance: getBalanceConfig(request.config),
        transactions: getTransactionsConfig(request.config),
        endpointTokenConfig: llm.endpointTokenConfig as never,
      });
    }
    return extractText(reply.content);
  };
}
