import { useEffect, useState } from 'react';
import { isWithinOpeningHours } from 'librechat-data-provider';
import type { TOpeningHours, TSupportService } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { useRebindOnStartupConfigRebuild } from '~/Providers/DeploymentTheme';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** How often an open tab re-reads the clock, so it closes within this long of `close`. */
const CHECK_INTERVAL_MS = 30_000;

/** The zone's everyday name ("United Kingdom Time"), or its IANA name where that is unsupported. */
function getZoneName(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone,
      timeZoneName: 'longGeneric',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Whether `openingHours` is open now by the server's clock. The startup config carries the
 * server's time; its offset from when the browser received it corrects a wrong device clock.
 */
function useIsOpen(
  hours: (TOpeningHours & { serverTime: number }) | undefined,
  receivedAt: number,
) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (hours == null) {
      return;
    }
    const id = setInterval(() => setTick((tick) => tick + 1), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hours]);

  if (hours == null) {
    return true;
  }
  const offset = receivedAt > 0 ? hours.serverTime - receivedAt : 0;
  return isWithinOpeningHours(hours, new Date(Date.now() + offset));
}

function SupportService({ service }: { service: TSupportService }) {
  const localize = useLocalize();
  return (
    <li className="border-border-light bg-surface-secondary rounded-lg border p-4">
      <h3 className="text-text-primary font-semibold">{service.name}</h3>
      {service.description != null && (
        <p className="text-text-secondary mt-1 text-sm">{service.description}</p>
      )}
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {service.phone != null && (
          <a
            className="text-text-primary underline"
            href={`tel:${service.phone.replace(/\s+/g, '')}`}
          >
            {localize('com_ui_resting_call', { phone: service.phone })}
          </a>
        )}
        {service.text != null && <span className="text-text-primary">{service.text}</span>}
        {service.url != null && (
          <a
            className="text-text-primary underline"
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {localize('com_ui_resting_visit', { name: service.name })}
          </a>
        )}
      </div>
    </li>
  );
}

export function RestingPage({ hours, appTitle }: { hours: TOpeningHours; appTitle: string }) {
  const localize = useLocalize();
  const support = hours.support ?? [];
  return (
    <main className="bg-surface-primary flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <img src="assets/logo.svg" className="mx-auto h-10 w-10 object-contain" alt="" />
        <h1 className="text-text-primary mt-4 text-center text-2xl font-semibold">
          {localize('com_ui_resting_title', { appTitle })}
        </h1>
        <p className="text-text-secondary mt-3 text-center">
          {localize('com_ui_resting_hours', {
            open: hours.open,
            close: hours.close,
            zone: getZoneName(hours.timezone),
          })}
        </p>
        {support.length > 0 && (
          <section className="mt-8" aria-labelledby="resting-support">
            <h2 id="resting-support" className="text-text-primary text-lg font-semibold">
              {localize('com_ui_resting_support')}
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {support.map((service) => (
                <SupportService key={service.name} service={service} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

/** Shows the resting page in place of the app outside `openingHours`. */
export default function OpeningHoursGate({ children }: { children: ReactNode }) {
  /* A failed sign-in (every API call fails while closed) removes the queries mid-fetch;
     without rebinding, this observer waits on the removed one and never sees the hours. */
  useRebindOnStartupConfigRebuild();
  const { data: startupConfig, dataUpdatedAt } = useGetStartupConfig();
  const hours = startupConfig?.openingHours;
  const isOpen = useIsOpen(hours, dataUpdatedAt);
  if (hours == null || isOpen) {
    return <>{children}</>;
  }
  return <RestingPage hours={hours} appTitle={startupConfig?.appTitle ?? 'LibreChat'} />;
}
