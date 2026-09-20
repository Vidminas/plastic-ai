const { ResourceType } = require('librechat-data-provider');

jest.mock('@librechat/api', () => {
  const { selectFileCitationSources, parseKbLocation } = jest.requireActual('@librechat/api');
  return {
    logAxiosError: jest.fn(),
    selectFileCitationSources,
    parseKbLocation,
    retrieveForFiles: jest.fn(),
    resolveBedrockKbConfig: jest.fn(),
  };
});

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('~/models', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/server/services/Files/permissions', () => ({
  filterFilesByAgentAccess: jest.fn((options) => Promise.resolve(options.files)),
}));

const { createFileSearchTool, primeFiles } = require('~/app/clients/tools/util/fileSearch');
const { retrieveForFiles, resolveBedrockKbConfig } = require('@librechat/api');

const kbConfig = { knowledgeBaseId: 'kb-1', dataSourceId: 'ds-1', bucket: 'bucket', prefix: 'kb/' };

const kbResult = ({ fileId, filename, text, score }) => ({
  fileId,
  content: { text },
  score,
  location: { s3Location: { uri: `s3://bucket/kb/${fileId}/${filename}` } },
});

describe('fileSearch.js - agent file authorization', () => {
  it('uses the permission resource type established by the calling route', async () => {
    const { getFiles } = require('~/models');
    const { filterFilesByAgentAccess } = require('~/server/services/Files/permissions');
    const files = [{ file_id: 'owner-file', filename: 'owner.pdf', user: 'agent-owner' }];
    getFiles.mockResolvedValueOnce(files);

    await primeFiles({
      req: { user: { id: 'remote-viewer', role: 'USER' } },
      agentId: 'agent-123',
      agentResourceType: ResourceType.REMOTE_AGENT,
      tool_resources: { file_search: { file_ids: ['owner-file'] } },
    });

    expect(filterFilesByAgentAccess).toHaveBeenCalledWith({
      files,
      userId: 'remote-viewer',
      role: 'USER',
      agentId: 'agent-123',
      resourceType: ResourceType.REMOTE_AGENT,
    });
  });
});

describe('fileSearch.js - knowledge base search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveBedrockKbConfig.mockResolvedValue(kbConfig);
  });

  it('returns a tuple when no files are provided', async () => {
    const tool = await createFileSearchTool({ userId: 'user1', files: [] });
    const result = await tool.func({ query: 'test query' });

    expect(result).toEqual(['No files to search. Instruct the user to add files for the search.', undefined]);
    expect(retrieveForFiles).not.toHaveBeenCalled();
  });

  it('reports that search is not configured when no knowledge base resolves', async () => {
    resolveBedrockKbConfig.mockResolvedValue(null);
    const tool = await createFileSearchTool({
      userId: 'user1',
      files: [{ file_id: 'file-1', filename: 'test.pdf' }],
    });
    const result = await tool.func({ query: 'test query' });

    expect(result).toEqual(['File search is not configured.', undefined]);
    expect(retrieveForFiles).not.toHaveBeenCalled();
  });

  it('returns a tuple when retrieval fails', async () => {
    retrieveForFiles.mockRejectedValue(new Error('Retrieve failed'));
    const tool = await createFileSearchTool({
      userId: 'user1',
      files: [{ file_id: 'file-1', filename: 'test.pdf' }],
    });
    const result = await tool.func({ query: 'test query' });

    expect(result).toEqual([
      'No results found or errors occurred while searching the files.',
      undefined,
    ]);
  });

  it('returns a tuple when nothing matches', async () => {
    retrieveForFiles.mockResolvedValue([]);
    const tool = await createFileSearchTool({
      userId: 'user1',
      files: [{ file_id: 'file-1', filename: 'test.pdf' }],
    });
    const [message, artifact] = await tool.func({ query: 'test query' });

    expect(message).toContain('No content found in the files');
    expect(artifact).toBeUndefined();
  });

  it('scopes retrieval to the requesting user and forwards each file with its origin', async () => {
    retrieveForFiles.mockResolvedValue([]);
    const files = [
      { file_id: 'kb-1', filename: 'kb.pdf', fromAgent: true },
      { file_id: 'user-1', filename: 'attachment.txt', fromAgent: false },
    ];
    const tool = await createFileSearchTool({ userId: 'user1', files });
    await tool.func({ query: 'q' });

    expect(retrieveForFiles).toHaveBeenCalledTimes(1);
    expect(retrieveForFiles).toHaveBeenCalledWith(kbConfig, {
      query: 'q',
      topK: 10,
      userId: 'user1',
      files,
    });
  });

  it('formats results with the stored filename and returns a sources artifact', async () => {
    retrieveForFiles.mockResolvedValue([
      kbResult({ fileId: 'file-123', filename: 'stored-name.pdf', text: 'First passage', score: 0.9 }),
      kbResult({ fileId: 'file-123', filename: 'stored-name.pdf', text: 'Second passage', score: 0.4 }),
    ]);
    const tool = await createFileSearchTool({
      userId: 'user1',
      files: [{ file_id: 'file-123', filename: 'test.pdf' }],
    });
    const [formattedString, artifact] = await tool.func({ query: 'test query' });

    expect(formattedString).toContain('File: test.pdf');
    expect(formattedString).toContain('Relevance: 0.9000');
    expect(formattedString).toContain('First passage');
    expect(formattedString).toContain('Second passage');
    expect(artifact.file_search.fileCitations).toBe(false);
    expect(artifact.file_search.sources).toHaveLength(2);
    expect(artifact.file_search.sources[0]).toMatchObject({
      type: 'file',
      fileId: 'file-123',
      fileName: 'test.pdf',
      content: 'First passage',
      relevance: 0.9,
      pages: [],
      pageRelevance: {},
    });
  });

  it('attributes each result to the file it came from', async () => {
    retrieveForFiles.mockResolvedValue([
      kbResult({ fileId: 'file-2', filename: 'file2.pdf', text: 'From file 2', score: 0.8 }),
      kbResult({ fileId: 'file-1', filename: 'file1.pdf', text: 'From file 1', score: 0.6 }),
    ]);
    const tool = await createFileSearchTool({
      userId: 'user1',
      files: [
        { file_id: 'file-1', filename: 'file1.pdf' },
        { file_id: 'file-2', filename: 'file2.pdf' },
      ],
    });
    const [formattedString, artifact] = await tool.func({ query: 'test query' });

    expect(formattedString).toContain('file1.pdf');
    expect(formattedString).toContain('file2.pdf');
    expect(artifact.file_search.sources.map((source) => source.fileId)).toEqual(['file-2', 'file-1']);
  });

  it('includes citation anchors when file citations are enabled', async () => {
    retrieveForFiles.mockResolvedValue([
      kbResult({ fileId: 'file-789', filename: 'doc.pdf', text: 'Content with citations', score: 0.85 }),
    ]);
    const tool = await createFileSearchTool({
      userId: 'user1',
      files: [{ file_id: 'file-789', filename: 'doc.pdf' }],
      fileCitations: true,
    });
    const [formattedString, artifact] = await tool.func({ query: 'test query' });

    expect(formattedString).toContain('Anchor:');
    expect(formattedString).toContain('\\ue202turn0file0');
    expect(artifact.file_search.fileCitations).toBe(true);
  });
});
