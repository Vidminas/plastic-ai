import { ErrorTypes } from 'librechat-data-provider';
import type { TUploadRejection } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import translation from '~/locales/en/translation.json';
import { localizeUploadRejection } from '../files';

const strings = translation as Record<string, string>;
const localize = (key: TranslationKeys, options?: Record<string, string>) =>
  (strings[key] ?? key).replace('{{0}}', options?.[0] ?? '');

const rejection = (
  reason: TUploadRejection['reason'],
  identifiers?: string[],
): TUploadRejection => ({
  message: `com_error_files_${reason}`,
  code: ErrorTypes.UPLOAD_REJECTED,
  reason,
  identifiers,
});

describe('localizeUploadRejection', () => {
  it.each<TUploadRejection['reason']>([
    'unsupported_type',
    'type_mismatch',
    'malware',
    'scan_unavailable',
    'unreadable',
    'too_long',
  ])('has an English message for %s', (reason) => {
    const message = localizeUploadRejection(rejection(reason), localize);
    expect(message).toBe(strings[`com_error_files_${reason}`]);
    expect(message).not.toMatch(/^com_/);
  });

  it('names each kind of identifier found once', () => {
    const message = localizeUploadRejection(
      rejection('identifiers', [
        'EMAIL',
        'INTERNATIONAL_BANK_ACCOUNT_NUMBER',
        'UK_NATIONAL_INSURANCE_NUMBER',
      ]),
      localize,
    );
    expect(message).toBe(
      "This file contains email addresses, bank account details, and National Insurance numbers, which can't be uploaded. Remove them and upload the file again.",
    );
  });

  it('falls back to a general label for an unknown identifier', () => {
    const message = localizeUploadRejection(rejection('identifiers', ['SOMETHING_NEW']), localize);
    expect(message).toContain('personal information');
  });
});
