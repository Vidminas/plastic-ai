import { useAtom } from 'jotai';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TSafeguardingErrorInfo, TSafeguardingReason } from 'librechat-data-provider';
import type { ErrorRendererProps } from '~/components/Messages/Content/Error/parts';
import type { TranslationKeys } from '~/hooks';
import { readObject, readString } from '~/components/Messages/Content/Error/parts';
import { safeguardingNoticeAtom } from '~/store/safeguarding';
import { SupportService } from '~/components/System/Resting';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

const CATEGORY_KEYS: Record<string, TranslationKeys> = {
  HATE: 'com_safeguarding_category_hate',
  INSULTS: 'com_safeguarding_category_insults',
  SEXUAL: 'com_safeguarding_category_sexual',
  VIOLENCE: 'com_safeguarding_category_violence',
  MISCONDUCT: 'com_safeguarding_category_misconduct',
  PROMPT_ATTACK: 'com_safeguarding_category_prompt_attack',
};

const TOPIC_KEYS: Record<string, TranslationKeys> = {
  'self-harm': 'com_safeguarding_topic_self_harm',
  'suicidal-ideation': 'com_safeguarding_topic_suicidal_ideation',
  'acute-distress': 'com_safeguarding_topic_acute_distress',
  bullying: 'com_safeguarding_topic_bullying',
};

const REASON_KEYS: Record<TSafeguardingReason['type'], Record<string, TranslationKeys>> = {
  content: CATEGORY_KEYS,
  topic: TOPIC_KEYS,
  model: { MODEL_FILTER: 'com_safeguarding_category_model_filter' },
};

const HEADLINE_KEYS: Record<TSafeguardingErrorInfo['source'], TranslationKeys> = {
  prompt: 'com_safeguarding_blocked_prompt',
  answer: 'com_safeguarding_blocked_answer',
  upload: 'com_safeguarding_blocked_upload',
  response: 'com_safeguarding_blocked_response',
};

/** The payload's `info`, read defensively: it crosses the wire as stored message text. */
export function readSafeguardingInfo(json: ErrorRendererProps['json']): TSafeguardingErrorInfo {
  const info = readObject(json, 'info');
  const source = readString(info, 'source');
  const rawReasons = info?.reasons;
  const reasons = (Array.isArray(rawReasons) ? rawReasons : []).flatMap(
    (reason): TSafeguardingReason[] => {
      if (typeof reason !== 'object' || reason == null || Array.isArray(reason)) {
        return [];
      }
      const type = readString(reason, 'type');
      const name = readString(reason, 'name');
      return (type === 'content' || type === 'topic' || type === 'model') && name
        ? [{ type, name }]
        : [];
    },
  );
  return {
    source:
      source != null && source in HEADLINE_KEYS
        ? (source as TSafeguardingErrorInfo['source'])
        : 'response',
    reasons,
    ...(info?.unavailable === true ? { unavailable: true } : {}),
  };
}

/** Lists the reasons as the participant reads them, in one sentence. */
function useReasonList(reasons: TSafeguardingReason[]): string {
  const localize = useLocalize();
  const labels = new Set(
    reasons.map(({ type, name }) =>
      localize(REASON_KEYS[type][name] ?? 'com_safeguarding_category_other'),
    ),
  );
  if (labels.size === 0) {
    labels.add(localize('com_safeguarding_category_other'));
  }
  return new Intl.ListFormat(undefined, { type: 'conjunction' }).format([...labels]);
}

/** Where to find help after a strong detection: `safeguarding.signposting` in librechat.yaml. */
export function SafeguardingSupport() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const support = startupConfig?.safeguardingSupport ?? [];
  if (support.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2" aria-label={localize('com_ui_resting_support')}>
      <p>{localize('com_safeguarding_support_intro')}</p>
      <ul className="flex flex-col gap-2">
        {support.map((service) => (
          <SupportService key={service.name} service={service} />
        ))}
      </ul>
    </section>
  );
}

/** What the participant is told about blocked content: what, why, and where to find help. */
function NoticeBody({ info }: { info: TSafeguardingErrorInfo }) {
  const localize = useLocalize();
  const reasons = useReasonList(info.reasons);
  if (info.unavailable) {
    return <>{localize('com_safeguarding_unavailable')}</>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p>{localize(HEADLINE_KEYS[info.source])}</p>
      <p>{localize('com_safeguarding_reason', { 0: reasons })}</p>
      <SafeguardingSupport />
    </div>
  );
}

/** The `safeguarding` error in a conversation: a blocked message, answer or response. */
export default function SafeguardingNotice({ json }: ErrorRendererProps) {
  return <NoticeBody info={readSafeguardingInfo(json)} />;
}

/** Shows a blocked upload's notice, with the support links, in a dialog. */
export function SafeguardingDialog() {
  const localize = useLocalize();
  const [info, setInfo] = useAtom(safeguardingNoticeAtom);
  return (
    <OGDialog open={info != null} onOpenChange={(open) => !open && setInfo(null)}>
      {info != null ? (
        <OGDialogTemplate
          title={localize('com_safeguarding_dialog_title')}
          className="max-w-md"
          showCancelButton={false}
          showCloseButton={true}
          main={<NoticeBody info={info} />}
        />
      ) : null}
    </OGDialog>
  );
}
