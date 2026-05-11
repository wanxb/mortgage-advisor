import { useId, useMemo } from 'react';
import { Info } from 'lucide-react';

export function Tooltip({
  text,
  children,
  className = '',
  position = 'top',
}: {
  text: string;
  children: React.ReactNode;
  className?: string;
  position?: 'top' | 'bottom';
}) {
  const positionClass =
    position === 'top'
      ? 'bottom-full mb-2 left-1/2 -translate-x-1/2'
      : 'top-full mt-2 left-1/2 -translate-x-1/2';

  return (
    <span className={`group relative inline-flex items-center ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-30 whitespace-pre rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-slate-700 ${positionClass}`}
      >
        {text}
      </span>
    </span>
  );
}

export function InfoHint({ text, className = '' }: { text: string; className?: string }) {
  return (
    <Tooltip text={text} className={className}>
      <Info size={14} className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300" aria-hidden />
      <span className="sr-only">{text}</span>
    </Tooltip>
  );
}

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  presets?: number[];
  inputClassName?: string;
  ariaLabel?: string;
  decimals?: number;
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = '',
  presets,
  inputClassName,
  ariaLabel,
  decimals,
}: SliderProps) {
  const id = useId();
  const safeValue = Number.isFinite(value) ? value : min;
  const clamped = Math.min(Math.max(safeValue, min), max);
  const progress = useMemo(() => {
    if (max === min) return 0;
    return Math.round(((clamped - min) / (max - min)) * 100);
  }, [clamped, min, max]);

  const handleChange = (raw: string) => {
    if (raw === '' || raw === '-') {
      onChange(min);
      return;
    }
    const next = Number(raw);
    if (Number.isNaN(next)) return;
    onChange(next);
  };

  const decimalsFromStep = step < 1 ? Math.min(3, String(step).split('.')[1]?.length || 0) : 0;
  const fixedDecimals = decimals ?? decimalsFromStep;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          className="advisor-range flex-1"
          style={{ ['--advisor-range-progress' as string]: `${progress}%` }}
          min={min}
          max={max}
          step={step}
          value={clamped}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={ariaLabel}
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={fixedDecimals > 0 ? Number(clamped.toFixed(fixedDecimals)) : clamped}
            onChange={(event) => handleChange(event.target.value)}
            className={
              inputClassName ||
              'h-10 w-20 rounded-md border border-slate-300 bg-white px-2 text-right text-base text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/40'
            }
          />
          {suffix ? <span className="text-sm text-slate-500 dark:text-slate-400">{suffix}</span> : null}
        </div>
      </div>
      {presets && presets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              className={`min-h-7 rounded-md border px-2 text-xs font-medium transition ${
                Math.abs(clamped - preset) < (step || 0.001) / 2
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-300'
              }`}
            >
              {preset}
              {suffix}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
