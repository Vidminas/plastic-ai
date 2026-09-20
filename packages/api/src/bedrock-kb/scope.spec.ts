import * as service from './service';
import { retrieveForFiles, resolveResultFileId, isBedrockKbConfigured } from './scope';
import type { KnowledgeBaseRetrievalResult } from '@aws-sdk/client-bedrock-agent-runtime';
import type { BedrockKbConfig } from './service';

const config: BedrockKbConfig = {
  knowledgeBaseId: 'kb-1',
  dataSourceId: 'ds-1',
  bucket: 'bucket',
  prefix: 'kb/',
};

const chunk = (fileId: string, userId: string | undefined, score: number): KnowledgeBaseRetrievalResult => ({
  content: { text: `chunk of ${fileId}` },
  score,
  location: { type: 'S3', s3Location: { uri: `s3://bucket/kb/${fileId}/doc.txt` } },
  metadata: { file_id: fileId, ...(userId ? { user_id: userId } : {}) },
});

describe('bedrock-kb scope', () => {
  let retrieve: jest.SpyInstance;

  beforeEach(() => {
    retrieve = jest.spyOn(service, 'retrieveFromKnowledgeBase');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildKbFilter', () => {
    it('pins user uploads to the file ids and the uploading user', () => {
      expect(service.buildKbFilter({ fileIds: ['f1'], userId: 'u1' })).toEqual({
        andAll: [
          { equals: { key: 'file_id', value: 'f1' } },
          { equals: { key: 'user_id', value: 'u1' } },
        ],
      });
    });

    it('matches multiple file ids with `in` and entity ids with `listContains`', () => {
      expect(service.buildKbFilter({ fileIds: ['f1', 'f2'], entityId: 'agent_1' })).toEqual({
        andAll: [
          { in: { key: 'file_id', value: ['f1', 'f2'] } },
          { listContains: { key: 'entity_ids', value: 'agent_1' } },
        ],
      });
    });

    it('returns no filter when nothing scopes the query', () => {
      expect(service.buildKbFilter({})).toBeUndefined();
    });
  });

  describe('retrieveFromKnowledgeBase', () => {
    it('refuses an unscoped retrieve against the shared knowledge base', async () => {
      retrieve.mockRestore();
      await expect(service.retrieveFromKnowledgeBase(config, { query: 'q' })).rejects.toThrow(
        /unscoped retrieve/,
      );
    });
  });

  describe('retrieveForFiles', () => {
    it('does not query when the requester has no entitled files', async () => {
      const results = await retrieveForFiles(config, { query: 'q', userId: 'u1', files: [] });

      expect(results).toEqual([]);
      expect(retrieve).not.toHaveBeenCalled();
    });

    it('does not query without a requester', async () => {
      const results = await retrieveForFiles(config, {
        query: 'q',
        userId: '',
        files: [{ file_id: 'f1' }],
      });

      expect(results).toEqual([]);
      expect(retrieve).not.toHaveBeenCalled();
    });

    it('scopes own uploads by user and agent files by file id alone', async () => {
      retrieve.mockResolvedValue([]);
      await retrieveForFiles(config, {
        query: 'q',
        topK: 5,
        userId: 'u1',
        files: [{ file_id: 'own-1' }, { file_id: 'agent-1', fromAgent: true }],
      });

      expect(retrieve).toHaveBeenCalledTimes(2);
      expect(retrieve).toHaveBeenCalledWith(config, {
        query: 'q',
        topK: 5,
        filter: {
          andAll: [
            { equals: { key: 'file_id', value: 'own-1' } },
            { equals: { key: 'user_id', value: 'u1' } },
          ],
        },
      });
      expect(retrieve).toHaveBeenCalledWith(config, {
        query: 'q',
        topK: 5,
        filter: { equals: { key: 'file_id', value: 'agent-1' } },
      });
    });

    it('treats a file listed as both own and agent as an agent file', async () => {
      retrieve.mockResolvedValue([]);
      await retrieveForFiles(config, {
        query: 'q',
        userId: 'u1',
        files: [{ file_id: 'f1' }, { file_id: 'f1', fromAgent: true }],
      });

      expect(retrieve).toHaveBeenCalledTimes(1);
      expect(retrieve).toHaveBeenCalledWith(config, {
        query: 'q',
        topK: undefined,
        filter: { equals: { key: 'file_id', value: 'f1' } },
      });
    });

    it('drops chunks from files outside the entitled set even if the backend returns them', async () => {
      retrieve.mockResolvedValue([
        chunk('own-1', 'u1', 0.9),
        chunk('someone-elses', 'u2', 0.95),
      ]);
      const results = await retrieveForFiles(config, {
        query: 'q',
        userId: 'u1',
        files: [{ file_id: 'own-1' }],
      });

      expect(results.map((result) => result.fileId)).toEqual(['own-1']);
    });

    it('drops an own-upload chunk that was uploaded by a different user', async () => {
      retrieve.mockResolvedValue([chunk('own-1', 'u2', 0.9), chunk('own-1', undefined, 0.8)]);
      const results = await retrieveForFiles(config, {
        query: 'q',
        userId: 'u1',
        files: [{ file_id: 'own-1' }],
      });

      expect(results).toEqual([]);
    });

    it('keeps agent files uploaded by another user', async () => {
      retrieve.mockResolvedValue([chunk('agent-1', 'agent-owner', 0.7)]);
      const results = await retrieveForFiles(config, {
        query: 'q',
        userId: 'u1',
        files: [{ file_id: 'agent-1', fromAgent: true }],
      });

      expect(results.map((result) => result.fileId)).toEqual(['agent-1']);
    });

    it('merges both scopes by score and honors topK', async () => {
      retrieve.mockImplementation(async (_config, params) => {
        const filter = JSON.stringify(params.filter);
        return filter.includes('own-1')
          ? [chunk('own-1', 'u1', 0.5), chunk('own-1', 'u1', 0.2)]
          : [chunk('agent-1', 'agent-owner', 0.8)];
      });
      const results = await retrieveForFiles(config, {
        query: 'q',
        topK: 2,
        userId: 'u1',
        files: [{ file_id: 'own-1' }, { file_id: 'agent-1', fromAgent: true }],
      });

      expect(results.map((result) => [result.fileId, result.score])).toEqual([
        ['agent-1', 0.8],
        ['own-1', 0.5],
      ]);
    });
  });

  describe('resolveResultFileId', () => {
    it('prefers the metadata file id over the object key', () => {
      const result = { ...chunk('meta-id', 'u1', 1) };
      result.location = { type: 'S3', s3Location: { uri: 's3://bucket/kb/uri-id/doc.txt' } };

      expect(resolveResultFileId(result)).toBe('meta-id');
    });

    it('falls back to the object key when metadata is absent', () => {
      const result: KnowledgeBaseRetrievalResult = {
        content: { text: 'chunk' },
        location: { type: 'S3', s3Location: { uri: 's3://bucket/kb/uri-id/doc.txt' } },
      };

      expect(resolveResultFileId(result)).toBe('uri-id');
    });
  });

  describe('isBedrockKbConfigured', () => {
    const original = { id: process.env.BEDROCK_KB_ID, name: process.env.BEDROCK_KB_NAME };

    afterEach(() => {
      process.env.BEDROCK_KB_ID = original.id;
      process.env.BEDROCK_KB_NAME = original.name;
      if (original.id === undefined) {
        delete process.env.BEDROCK_KB_ID;
      }
      if (original.name === undefined) {
        delete process.env.BEDROCK_KB_NAME;
      }
    });

    it('is true for either an id or a name and false for neither', () => {
      delete process.env.BEDROCK_KB_ID;
      delete process.env.BEDROCK_KB_NAME;
      expect(isBedrockKbConfigured()).toBe(false);

      process.env.BEDROCK_KB_NAME = 'librechat-kb';
      expect(isBedrockKbConfigured()).toBe(true);

      delete process.env.BEDROCK_KB_NAME;
      process.env.BEDROCK_KB_ID = 'kb-1';
      expect(isBedrockKbConfigured()).toBe(true);
    });
  });
});
