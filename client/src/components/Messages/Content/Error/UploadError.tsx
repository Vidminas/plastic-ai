import { isUploadRejection } from 'librechat-data-provider';
import type { ErrorRendererProps } from './parts';
import { localizeUploadRejection } from '~/utils/files';
import { useLocalize } from '~/hooks';

/**
 * An upload `uploadScreening` refused, named by its reason, as the composer shows it. A payload
 * without a known reason reads as a failed upload.
 */
export default function UploadError({ json }: ErrorRendererProps) {
  const localize = useLocalize();
  const rejection = { ...json, code: json.code ?? json.type };
  if (!isUploadRejection(rejection)) {
    return <>{localize('com_error_files_upload')}</>;
  }
  return <>{localizeUploadRejection(rejection, localize)}</>;
}
