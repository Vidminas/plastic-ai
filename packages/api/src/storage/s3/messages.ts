import { FileSources } from 'librechat-data-provider';
import { refreshS3Url } from './crud';

interface MessageFileRef {
  source?: string;
  filepath?: string;
  storageKey?: string;
}

interface MessageWithFiles {
  files?: MessageFileRef[] | null;
  attachments?: MessageFileRef[] | null;
}

function queueRefresh(files: MessageFileRef[] | null | undefined, pending: Promise<void>[]) {
  if (!Array.isArray(files)) {
    return;
  }
  for (const file of files) {
    const { source, filepath, storageKey } = file ?? {};
    if (source !== FileSources.s3 || !filepath) {
      continue;
    }
    pending.push(
      refreshS3Url({ source, filepath, storageKey }).then((url) => {
        file.filepath = url;
      }),
    );
  }
}

/**
 * Renews the S3 links of files embedded in messages. A message keeps the link
 * it was sent with: a presigned URL stops working after `S3_URL_EXPIRY_SECONDS`,
 * and with `S3_PROXY_FILES` it is replaced by the app's own link. Either way
 * this makes no S3 or database call. Updates the messages in place and returns
 * them; a file whose link cannot be renewed keeps its old one.
 */
export async function refreshMessageFileUrls<T extends MessageWithFiles>(
  messages: T[],
): Promise<T[]> {
  const pending: Promise<void>[] = [];
  for (const message of messages) {
    queueRefresh(message.files, pending);
    queueRefresh(message.attachments, pending);
  }
  await Promise.all(pending);
  return messages;
}
