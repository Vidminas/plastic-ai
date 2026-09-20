// import axios from 'axios';
import { logger } from '@librechat/data-schemas';
// import { generateShortLivedToken } from '~/crypto/jwt';
import { removeFileFromKnowledgeBase } from '~/bedrock-kb/ingest';

interface DeleteRagFileParams {
  /** The user ID. Required for authentication. If not provided, the function returns false and logs an error. */
  userId: string;
  /** The file object. Must have `embedded` and `file_id` properties. */
  file: {
    file_id: string;
    embedded?: boolean;
    s3DataSourceKey?: string;
  };
}

/**
 * Deletes embedded document(s) from the Bedrock Knowledge Base.
 * This is a shared utility function used by all file storage strategies
 * (S3, Azure, Firebase, Local) to delete KB ingestion state when a file is deleted.
 *
 * @param params - The parameters object.
 * @param params.userId - The user ID (unused by the KB path; kept for call-site compatibility).
 * @param params.file - The file object. Must have `embedded`, `file_id`, and `s3DataSourceKey` properties.
 * @returns Returns true if deletion was successful or skipped, false if there was an error.
 */
export async function deleteRagFile({ file }: DeleteRagFileParams): Promise<boolean> {
  if (!file.embedded || !file.s3DataSourceKey) {
    return true;
  }

  // if (!process.env.RAG_API_URL) {
  //   return true;
  // }
  // if (!userId) {
  //   logger.error('[deleteRagFile] No user ID provided');
  //   return false;
  // }
  // const jwtToken = generateShortLivedToken(userId);
  // try {
  //   await axios.delete(`${process.env.RAG_API_URL}/documents`, {
  //     headers: {
  //       Authorization: `Bearer ${jwtToken}`,
  //       'Content-Type': 'application/json',
  //       accept: 'application/json',
  //     },
  //     data: [file.file_id],
  //   });
  //   logger.debug(`[deleteRagFile] Successfully deleted document ${file.file_id} from RAG API`);
  //   return true;
  // } catch (error) {
  //   const axiosError = error as { response?: { status?: number }; message?: string };
  //   if (axiosError.response?.status === 404) {
  //     logger.warn(
  //       `[deleteRagFile] Document ${file.file_id} not found in RAG API, may have been deleted already`,
  //     );
  //     return true;
  //   } else {
  //     logger.error('[deleteRagFile] Error deleting document from RAG API:', axiosError.message);
  //     return false;
  //   }
  // }

  try {
    await removeFileFromKnowledgeBase(file.s3DataSourceKey);
    logger.debug(`[deleteRagFile] Successfully deleted KB object for ${file.file_id}`);
    return true;
  } catch (error) {
    logger.error('[deleteRagFile] Error deleting object from Bedrock Knowledge Base:', error);
    return false;
  }
}
