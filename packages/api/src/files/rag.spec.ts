jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('~/bedrock-kb/ingest', () => ({
  removeFileFromKnowledgeBase: jest.fn(),
}));

import { deleteRagFile } from './rag';
import { logger } from '@librechat/data-schemas';
import { removeFileFromKnowledgeBase } from '~/bedrock-kb/ingest';

const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedRemoveFileFromKnowledgeBase = removeFileFromKnowledgeBase as jest.MockedFunction<
  typeof removeFileFromKnowledgeBase
>;

describe('deleteRagFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when file is embedded and has an s3DataSourceKey', () => {
    it('should delete the KB object successfully', async () => {
      const file = { file_id: 'file-123', embedded: true, s3DataSourceKey: 'kb/file-123/doc.txt' };
      mockedRemoveFileFromKnowledgeBase.mockResolvedValueOnce(undefined);

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedRemoveFileFromKnowledgeBase).toHaveBeenCalledWith('kb/file-123/doc.txt');
      expect(mockedLogger.debug).toHaveBeenCalledWith(
        '[deleteRagFile] Successfully deleted KB object for file-123',
      );
    });

    it('should return false and log error when deletion fails', async () => {
      const file = { file_id: 'file-error', embedded: true, s3DataSourceKey: 'kb/file-error/doc.txt' };
      const error = new Error('Server Error');
      mockedRemoveFileFromKnowledgeBase.mockRejectedValueOnce(error);

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(false);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        '[deleteRagFile] Error deleting object from Bedrock Knowledge Base:',
        error,
      );
    });
  });

  describe('when file is not embedded', () => {
    it('should skip KB deletion and return true', async () => {
      const file = { file_id: 'file-123', embedded: false, s3DataSourceKey: 'kb/file-123/doc.txt' };

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedRemoveFileFromKnowledgeBase).not.toHaveBeenCalled();
    });

    it('should skip KB deletion when embedded is undefined', async () => {
      const file = { file_id: 'file-123' };

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedRemoveFileFromKnowledgeBase).not.toHaveBeenCalled();
    });
  });

  describe('when file has no s3DataSourceKey', () => {
    it('should skip KB deletion and return true', async () => {
      const file = { file_id: 'file-123', embedded: true };

      const result = await deleteRagFile({ userId: 'user123', file });

      expect(result).toBe(true);
      expect(mockedRemoveFileFromKnowledgeBase).not.toHaveBeenCalled();
    });
  });
});
