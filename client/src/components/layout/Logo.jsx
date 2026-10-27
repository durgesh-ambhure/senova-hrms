import clsx from 'clsx';
import logoUrl from '../../assets/brand/senova-logo.png';
import markUrl from '../../assets/brand/senova-mark.png';

/**
 * Brand logo. The full artwork has a white "SENOVA" wordmark, so it is used on dark surfaces only
 * (`inverted`); on light surfaces the icon is paired with live text in the brand colours.
 */
export function Logo({ inverted = false, compact = false, size = 'md' }) {
  if (compact) return <img src={markUrl} alt="Senova HRMS" className="h-9 w-auto shrink-0" />;
  if (inverted) return <img src={logoUrl} alt="Senova HRMS" className={clsx('relative w-auto shrink-0 self-start object-contain', size === 'lg' ? 'h-24' : 'h-11 self-center')} />;
  return (
    <div className="relative flex items-center gap-2.5">
      <img src={markUrl} alt="" className="h-10 w-auto shrink-0" />
      <div className="leading-none">
        <span className="block text-lg font-extrabold tracking-[0.12em] text-brand-900">SENOVA</span>
        <span className="block text-sm font-bold tracking-[0.08em] text-[#1683d8]">HRMS</span>
      </div>
      <span className="sr-only">Senova HRMS</span>
    </div>
  );
}
