import { initializeModel } from '@librechat/agents';
import { CallbackHandler } from '@langfuse/langchain';
import { propagateAttributes } from '@langfuse/tracing';
import { EModelEndpoint } from 'librechat-data-provider';
import { RunnableLambda } from '@librechat/agents/langchain/runnables';
import type { AppConfig } from '@librechat/data-schemas';
import type { ClientOptions } from '@librechat/agents';
import type { Request } from 'express';
import type { CollectedMetadataEntry } from '~/agents/activityLabels/host';
import type { EndpointDbMethods, ServerRequest } from '~/types';
import type { LangfuseTraceUser } from '~/langfuse/identity';
import type { AgencyClassifierDeps } from './classify';
import type { RecordUsageDeps } from '~/agents/usage';
import {
  LABEL_MAX_OUTPUT_TOKENS,
  resolveActivityLabelModel,
  mapCollectedMetadataToUsage,
} from '~/agents/activityLabels/host';
import { hasLangfuseEnvCredentials, usesLangfuseMultiTenantRouting } from '~/langfuse/policy';
import { getBalanceConfig, getTransactionsConfig } from '~/app/config';
import { extractText } from '~/agents/activityLabels/runtime';
import { buildLangfuseConfig } from '~/langfuse/config';
import { recordCollectedUsage } from '~/agents/usage';

/** How long a label may take before it is given up. */
const CLASSIFIER_TIMEOUT_MS = 20_000;

/** Names the classifier's trace in Langfuse, and tells it from a chat turn in HyperDX. */
const CLASSIFIER_RUN_NAME = 'agency-classifier';

type ClassifierTrace = {
  handler: CallbackHandler;
  attributes: { userId: string; sessionId: string; metadata?: Record<string, string> };
};

/**
 * Traces the call in Langfuse under the turn's conversation, as a chat's calls are, with the same
 * sampling and user id. Its input is already masked. With tenant routing there is no telling
 * where the trace belongs, so it is not traced.
 */
function classifierTrace(
  request: ServerRequest & { config?: AppConfig },
  user: string,
  ids: { conversationId: string; messageId?: string },
): ClassifierTrace | undefined {
  const langfuse = buildLangfuseConfig({
    appConfig: request.config,
    runId: ids.messageId,
    user: request.user as LangfuseTraceUser | undefined,
  });
  if (
    langfuse.enabled === false ||
    !hasLangfuseEnvCredentials() ||
    usesLangfuseMultiTenantRouting()
  ) {
    return undefined;
  }
  const userId = langfuse.userId ?? user;
  return {
    handler: new CallbackHandler({
      userId,
      sessionId: ids.conversationId,
      tags: ['librechat', CLASSIFIER_RUN_NAME],
    }),
    attributes: {
      userId,
      sessionId: ids.conversationId,
      ...(ids.messageId != null && { metadata: { messageId: ids.messageId } }),
    },
  };
}

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
    const options = { signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS) };
    const trace = classifierTrace(request, user, ids);
    /** The handler names a trace and gives it its user and conversation only from a chain, never
     *  a bare model call, and Langfuse files each span by the user and conversation on it, so
     *  the call runs inside a named chain with both set on every span. Without them it is a
     *  nameless trace HyperDX cannot find by user, conversation or `agency-classifier`. */
    const reply: ModelReply =
      trace == null
        ? await model.invoke(prompt, options)
        : await propagateAttributes({ ...trace.attributes, traceName: CLASSIFIER_RUN_NAME }, () =>
            RunnableLambda.from((input: string, config?: object) =>
              model.invoke(input, config),
            ).invoke(prompt, {
              ...options,
              runName: CLASSIFIER_RUN_NAME,
              callbacks: [trace.handler],
            }),
          );
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
