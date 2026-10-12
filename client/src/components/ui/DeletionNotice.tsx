import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

/**
 * Tells the user, in a delete dialog, that deleting removes something from the app but not
 * from records the deployment keeps outside it. Shown only when `interface.deletionLogNotice`
 * is set in librechat.yaml.
 */
export default function DeletionNotice({ id }: { id?: string }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  if (startupConfig?.interface?.deletionLogNotice !== true) {
    return null;
  }
  return (
    <p id={id} className="text-text-secondary text-sm">
      {localize('com_ui_delete_log_notice')}
    </p>
  );
}
