import { useId } from 'react';
import { useSetAtom } from 'jotai';
import { NotebookPen } from 'lucide-react';
import { Button } from '@librechat/client';
import type { TAgencyRecap, TAgencyReflection } from 'librechat-data-provider';
import { reflectionDialogAtom } from '~/store/agency';
import Panel, { PanelHeading } from './Panel';
import { useLocalize } from '~/hooks';

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

function Answer({ label, text }: { label: string; text: string }) {
  if (!text) {
    return null;
  }
  return (
    <div>
      <dt className="text-text-secondary text-xs">{label}</dt>
      <dd className="text-text-primary line-clamp-2 text-sm">{text}</dd>
    </div>
  );
}

function Recent({ reflection }: { reflection: TAgencyReflection }) {
  const localize = useLocalize();
  const openReflection = useSetAtom(reflectionDialogAtom);
  const { answers } = reflection;
  const title = answers.working_on || localize('com_agency_reflection_untitled');
  return (
    <li className="border-border-light flex items-start gap-3 border-t py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <p className="text-text-primary line-clamp-2 text-sm font-medium">{title}</p>
        <p className="text-text-secondary mb-1 text-xs">
          <time dateTime={reflection.createdAt}>{when.format(new Date(reflection.createdAt))}</time>
        </p>
        <dl className="flex flex-col gap-1">
          <Answer label={localize('com_agency_recap_reflection_decided')} text={answers.decision} />
          <Answer label={localize('com_agency_recap_reflection_happy')} text={answers.happy} />
        </dl>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={localize('com_agency_recap_reflection_open', { 0: title })}
        onClick={() => openReflection({ reflectionId: reflection.id })}
      >
        {localize('com_agency_reflection_open')}
      </Button>
    </li>
  );
}

/**
 * The period's saved reflections at a glance: how many, and the latest few with what the
 * learner decided and whether they were happy with it, each opening in the reflection dialog.
 */
export default function Reflections({ recap }: { recap: TAgencyRecap }) {
  const localize = useLocalize();
  const headingId = useId();
  const openReflections = useSetAtom(reflectionDialogAtom);
  /** A server from before the overview sends none. */
  const { count, recent } = recap.reflections ?? { count: 0, recent: [] };
  return (
    <Panel>
      <PanelHeading
        id={headingId}
        icon={NotebookPen}
        tone="teal"
        title={localize('com_agency_recap_reflections_title')}
      />
      <p className="text-text-secondary -mt-2 mb-3 text-sm">
        {count === 0
          ? localize('com_agency_recap_reflections_empty')
          : localize('com_agency_recap_reflections_count', { count })}
      </p>
      {recent.length > 0 && (
        <ul aria-labelledby={headingId} className="mb-3">
          {recent.map((reflection) => (
            <Recent key={reflection.id} reflection={reflection} />
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => openReflections({})}>
        {localize(
          count === 0 ? 'com_agency_recap_reflections_write' : 'com_agency_recap_reflections_all',
        )}
      </Button>
    </Panel>
  );
}
