import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '~/utils';

/**
 * The warm accents the journey page uses, from the theme's categorical series, so they follow
 * light and dark. Each tints an icon's chip and colours the icon; text keeps its own ink.
 */
export const TONES = {
  orange: 'bg-series-2/15 text-series-2',
  amber: 'bg-series-4/15 text-series-4',
  pink: 'bg-series-5/15 text-series-5',
  teal: 'bg-series-3/15 text-series-3',
} as const;
export type Tone = keyof typeof TONES;

/** A recap card. */
export default function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'border-border-light bg-surface-primary rounded-theme-surface min-w-0 border p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** An icon in a tinted chip, sized by its padding wherever it sits (a flex box, never an inline
 *  span whose padded background would spill past its line). */
export function ToneIcon({
  icon: Icon,
  tone,
  className = 'rounded-lg p-2',
  size = 'size-4',
}: {
  icon: LucideIcon;
  tone: Tone;
  className?: string;
  size?: string;
}) {
  return (
    <span
      className={cn(TONES[tone], 'inline-flex shrink-0 items-center justify-center', className)}
      aria-hidden="true"
    >
      <Icon className={size} />
    </span>
  );
}

/** A panel's title, with its icon in a warm chip. */
export function PanelHeading({
  title,
  id,
  icon,
  tone = 'orange',
}: {
  title: string;
  id?: string;
  icon?: LucideIcon;
  tone?: Tone;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      {icon != null && <ToneIcon icon={icon} tone={tone} />}
      <h2 id={id} className="text-text-primary text-lg font-medium">
        {title}
      </h2>
    </div>
  );
}
