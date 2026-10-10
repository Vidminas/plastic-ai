import { ErrorTypes } from 'librechat-data-provider';
import type { TUploadRejection } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import translation from '~/locales/en/translation.json';
import { localizeUploadRejection } from '../files';

const strings = translation as Record<string, string>;
const localize = (key: TranslationKeys) => strings[key] ?? key;

describe('localizeUploadRejection', () => {
  it.each<TUploadRejection['reason']>(['scan_unavailable'])(
    'has an English message for %s',
    (reason) => {
      const message = localizeUploadRejection(
        { message: `com_error_files_${reason}`, code: ErrorTypes.UPLOAD_REJECTED, reason },
        localize,
      );
      expect(message).toBe(strings[`com_error_files_${reason}`]);
      expect(message).not.toMatch(/^com_/);
    },
  );
});
