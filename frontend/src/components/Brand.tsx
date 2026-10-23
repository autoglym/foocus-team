import { cn } from '@/lib/utils';

export const APP_NAME = 'Foocus Team';
/** Product tag shown after "FOOCUS" in the wordmark, as in "FOOCUS Intelligence". */
const PRODUCT_TAG = 'Team';

/** The Foocus owl pictogram — two eyes ("OO") under a brow, in a cerulean disc. */
export function FoocusMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-6 w-6 shrink-0', className)} role="img" aria-label="Foocus">
      <circle cx="16" cy="16" r="16" fill="#346F91" />
      <g fill="none" stroke="#15171F" strokeWidth="3.2">
        <circle cx="11.6" cy="18.2" r="4.2" />
        <circle cx="20.4" cy="18.2" r="4.2" />
      </g>
      <path
        fill="#15171F"
        d="M3.8 11.2 C 7.4 12.6 9.4 13 11.6 13.1 C 14.4 13.4 17.6 13.4 20.4 13.1 C 22.6 13 24.6 12.6 28.2 11.2 C 26.9 13 25 13.9 22.8 14.5 C 19.4 15.2 12.6 15.2 9.2 14.5 C 7 13.9 5.1 13 3.8 11.2 Z"
      />
    </svg>
  );
}

/** Foocus owl + "FOOCUS" + product tag, as in the Foocus wordmark. */
export function Wordmark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <FoocusMark className="h-8 w-8" />
      <span
        className={cn(
          'font-heading text-[15px] font-bold uppercase tracking-[0.06em]',
          inverted ? 'text-white' : 'text-slack-primary',
        )}
      >
        Foocus
      </span>
      <span className={cn('text-[15px] font-light tracking-tight', inverted ? 'text-white/60' : 'text-slack-hint')}>
        {PRODUCT_TAG}
      </span>
    </span>
  );
}
