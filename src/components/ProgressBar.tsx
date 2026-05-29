interface ProgressBarProps {
  /** 0-100 */
  value: number;
  label?: string;
  /** Whether to show the shimmer sweep over the filled track. */
  active?: boolean;
}

export function ProgressBar({ value, label, active = true }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-sm font-mono text-muted">{label}</span>
        <span className="text-base font-mono text-accent tabular-nums">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-border overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        >
          {active && pct < 100 && (
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}
