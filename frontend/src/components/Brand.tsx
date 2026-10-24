import { cn } from '@/lib/utils';

export const APP_NAME = 'Foocus Team';

/** The FOOCUS text logo, optionally followed by the product tag "Team". */
export function Wordmark({
  className,
  inverted = false,
  showTag = true,
}: {
  className?: string;
  inverted?: boolean;
  showTag?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <span
        className={cn(
          'font-heading text-[17px] font-extrabold uppercase tracking-[0.14em]',
          inverted ? 'text-white' : 'text-slack-primary',
        )}
      >
        Foocus
      </span>
      {showTag ? (
        <span className={cn('text-[15px] font-light tracking-tight', inverted ? 'text-white/55' : 'text-slack-hint')}>
          Team
        </span>
      ) : null}
    </span>
  );
}
