import { retrieveFromKnowledgeBase, buildKbFilter } from './service';
import type { KnowledgeBaseRetrievalResult } from '@aws-sdk/client-bedrock-agent-runtime';
import type { BedrockKbConfig } from './service';

export interface ScopedFile {
  file_id: string;
  /** Agent-owned files may be uploaded by another user and reached through agent access; everything else must be the requester's own upload. */
  fromAgent?: boolean;
}

export interface ScopedRetrievalResult extends KnowledgeBaseRetrievalResult {
  fileId: string;
}

export interface ScopedRetrieveParams {
  query: string;
  topK?: number;
  userId: string;
  files: ScopedFile[];
}

/** Synchronous check that a Knowledge Base is configured; the id itself is resolved lazily by `resolveBedrockKbConfig`. */
export const isBedrockKbConfigured = (): boolean =>
  Boolean(process.env.BEDROCK_KB_ID || process.env.BEDROCK_KB_NAME);

/** `writeKbObject` writes `<prefix><file_id>/<filename>`; the sidecar metadata is authoritative, the URI is the fallback. */
export function parseKbLocation(uri?: string): { file_id?: string; filename?: string } {
  const segments = (uri ?? '').split('/').filter(Boolean);
  const filename = segments.pop();
  const file_id = segments.pop();
  return { file_id, filename };
}

const metadataString = (result: KnowledgeBaseRetrievalResult, key: string): string | undefined => {
  const value = result.metadata?.[key];
  return typeof value === 'string' ? value : undefined;
};

export function resolveResultFileId(result: KnowledgeBaseRetrievalResult): string | undefined {
  return metadataString(result, 'file_id') ?? parseKbLocation(result.location?.s3Location?.uri).file_id;
}

const uniqueIds = (files: ScopedFile[]): string[] =>
  Array.from(new Set(files.map((file) => file.file_id).filter(Boolean)));

/**
 * Retrieves only from files the requester is entitled to. Requester-owned uploads are additionally
 * pinned to `user_id`, agent files are scoped by `file_id` alone (access to the agent is checked upstream),
 * and every result is re-checked against the entitled set so a backend that ignores or under-applies
 * a filter cannot leak another user's chunks. No entitled files means no query.
 */
export async function retrieveForFiles(
  config: BedrockKbConfig,
  { query, topK, userId, files }: ScopedRetrieveParams,
): Promise<ScopedRetrievalResult[]> {
  if (!userId) {
    return [];
  }
  const agentIds = uniqueIds(files.filter((file) => file.fromAgent === true));
  const agentIdSet = new Set(agentIds);
  const ownIds = uniqueIds(files.filter((file) => file.fromAgent !== true)).filter(
    (id) => !agentIdSet.has(id),
  );

  const scopes = [
    { ids: ownIds, filter: buildKbFilter({ fileIds: ownIds, userId }), ownedOnly: true },
    { ids: agentIds, filter: buildKbFilter({ fileIds: agentIds }), ownedOnly: false },
  ].filter((scope) => scope.ids.length > 0);

  const perScope = await Promise.all(
    scopes.map(async ({ ids, filter, ownedOnly }) => {
      const allowed = new Set(ids);
      const results = await retrieveFromKnowledgeBase(config, { query, topK, filter });
      return results.reduce<ScopedRetrievalResult[]>((kept, result) => {
        const fileId = resolveResultFileId(result);
        if (!fileId || !allowed.has(fileId)) {
          return kept;
        }
        if (ownedOnly && metadataString(result, 'user_id') !== userId) {
          return kept;
        }
        kept.push({ ...result, fileId });
        return kept;
      }, []);
    }),
  );

  const merged = perScope.flat().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return topK ? merged.slice(0, topK) : merged;
}
