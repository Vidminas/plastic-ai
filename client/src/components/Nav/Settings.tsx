import { lazy, Suspense, useEffect } from 'react';
import { atom, useAtom } from 'jotai';

export const settingsOpenAtom = atom(false);

/** The tab the settings dialog opens on, when something opens it at one; read once on open. */
export const settingsInitialTabAtom = atom<string | null>(null);

/** Keep settings lazy without tying its lifetime to a responsive account-menu trigger. */
const SettingsDialog = lazy(() => import('./Settings/Dialog'));

export default function Settings() {
  const [open, setOpen] = useAtom(settingsOpenAtom);

  useEffect(() => () => setOpen(false), [setOpen]);

  return open ? (
    <Suspense fallback={null}>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </Suspense>
  ) : null;
}
