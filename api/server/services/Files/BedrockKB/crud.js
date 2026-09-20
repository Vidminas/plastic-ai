const fs = require('fs');
const { FileSources } = require('librechat-data-provider');
const {
  ingestFileToKnowledgeBase,
  removeFileFromKnowledgeBase,
} = require('@librechat/api');

const DEFAULT_INGESTION_DEBOUNCE_SECONDS = 8;

const resolveDebounceSeconds = (req) =>
  req?.config?.bedrockKnowledgeBase?.ingestionDebounceSeconds ?? DEFAULT_INGESTION_DEBOUNCE_SECONDS;

/**
 * Uploads a file to the configured Bedrock Knowledge Base. Drop-in replacement for
 * `VectorDB/crud.js`'s `uploadVectors` at both of its call sites (`process.js`'s direct
 * dual-storage block and `provision.js`'s injected `uploadVectors` dependency) — same
 * params shape, and the parts of the return value both callers read (`embedded`) match.
 *
 * @param {Object} params
 * @param {Object} params.req - The request object from Express. Needs a `user.id` and,
 *   optionally, `config.bedrockKnowledgeBase.ingestionDebounceSeconds`.
 * @param {Express.Multer.File} params.file - The uploaded file; `path` points at its temp location.
 * @param {string} params.file_id - The file ID.
 * @param {string} [params.entity_id] - The entity ID for shared resources.
 *
 * @returns {Promise<{ bytes: number, filename: string, filepath: string, embedded: boolean,
 *   ingestionStatus: string, s3DataSourceKey: string, kbIngestionRequestedAt: string }>}
 */
async function ingestToKnowledgeBase({ req, file, file_id, entity_id }) {
  const buffer = await fs.promises.readFile(file.path);
  const result = await ingestFileToKnowledgeBase(
    {
      fileId: file_id,
      userId: req.user.id,
      filename: file.originalname,
      buffer,
      contentType: file.mimetype,
      entityIds: entity_id ? [entity_id] : undefined,
    },
    resolveDebounceSeconds(req),
  );
  if (!result) {
    throw new Error('BEDROCK_KB_ID/BEDROCK_KB_DATA_SOURCE_ID not defined');
  }
  return {
    bytes: file.size,
    filename: file.originalname,
    filepath: FileSources.bedrock_kb,
    embedded: result.embedded,
    ingestionStatus: result.ingestionStatus,
    s3DataSourceKey: result.s3Key,
    kbIngestionRequestedAt: result.kbIngestionRequestedAt,
  };
}

/**
 * Deletes a file's object (and metadata sidecar) from the KB's S3 data source, then
 * schedules ingestion so the deletion is reflected in the KB.
 *
 * @param {ServerRequest} req - The request object from Express.
 * @param {MongoFile} file - The file to delete. Needs `s3DataSourceKey`.
 */
async function deleteFromKnowledgeBase(req, file) {
  if (!file.s3DataSourceKey) {
    return;
  }
  await removeFileFromKnowledgeBase(file.s3DataSourceKey, resolveDebounceSeconds(req));
}

module.exports = {
  ingestToKnowledgeBase,
  deleteFromKnowledgeBase,
};
