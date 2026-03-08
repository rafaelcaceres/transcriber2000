interface WaveformIconProps {
  animate?: boolean;
  className?: string;
}

const bars = [3, 6, 9, 12, 8, 5, 10, 7, 4, 11, 6, 9, 3, 7, 5];

export function WaveformIcon({ animate = false, className }: WaveformIconProps) {
  return (
    <div className={`flex items-center gap-[2px] h-6 ${className ?? ""}`}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm bg-accent"
          style={{
            height: `${h}px`,
            transition: animate ? "height 0.15s ease" : "height 0.3s ease",
            animation: animate
              ? `pulse ${0.4 + (i % 3) * 0.15}s ease-in-out infinite alternate`
              : "none",
          }}
        />
      ))}
    </div>
  );
}
