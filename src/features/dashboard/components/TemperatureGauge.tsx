import { useCountUp } from '../hooks/useCountUp';

const SIZE = 180;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
// 270° sweep (a gauge dial, not a full ring) starting at 135° and ending at 45°.
const SWEEP_DEG = 270;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_LENGTH = (CIRCUMFERENCE * SWEEP_DEG) / 360;
const START_ANGLE_DEG = -225; // matches the SVG's -225deg rotation below
const TICK_COUNT = 7; // 8 marks across the sweep, evenly spaced

const TICK_ANGLES = Array.from({ length: TICK_COUNT + 1 }, (_, i) => START_ANGLE_DEG + (SWEEP_DEG * i) / TICK_COUNT);

function tickLine(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const outer = RADIUS + STROKE / 2 + 2;
  const inner = RADIUS - STROKE / 2 - 4;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  return {
    x1: cx + inner * Math.cos(rad),
    y1: cy + inner * Math.sin(rad),
    x2: cx + outer * Math.cos(rad),
    y2: cy + outer * Math.sin(rad),
  };
}

function arcColor(percent: number): string {
  if (percent >= 85) return 'var(--color-status-critical)';
  if (percent >= 60) return 'var(--color-status-warn)';
  return 'var(--color-primary)';
}

interface TemperatureGaugeProps {
  label: string;
  value: number | null;
  unit?: string;
  min: number;
  max: number;
  unavailable?: boolean;
}

// Animated arc gauge for a live temperature reading - a circular, dial-style
// counterpart to ReadingTile's flat fill-bar, reserved for the two headline
// readings (OTI/WTI) rather than every stat on the page.
export function TemperatureGauge({ label, value, unit, min, max, unavailable }: TemperatureGaugeProps) {
  const displayValue = useCountUp(value);
  const percent =
    value !== null ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  const offset = ARC_LENGTH - (ARC_LENGTH * percent) / 100;
  const color = unavailable || value === null ? 'var(--color-surface-300)' : arcColor(percent);
  const rounded = displayValue === null ? null : Math.round(displayValue * 10) / 10;

  return (
    <div className="relative flex flex-col items-center gap-1 px-4 py-4 bg-surface-0 rounded-lg border border-surface-200 card-hover">
      <span className="relative self-start text-[11px] font-semibold uppercase tracking-wider text-surface-500">
        {label}
      </span>
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <g opacity={unavailable ? 0.4 : 0.8}>
            {TICK_ANGLES.map((angle, i) => {
              const { x1, y1, x2, y2 } = tickLine(angle);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--color-surface-300)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              );
            })}
          </g>
          <g transform={`rotate(-225 ${SIZE / 2} ${SIZE / 2})`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--color-surface-200)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 700ms ease-out, stroke 700ms ease-out' }}
            />
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`font-mono tabular-nums text-4xl font-semibold transition-colors duration-300 ${unavailable ? 'text-status-critical/60' : 'text-surface-900'}`}
          >
            {rounded === null ? (unavailable ? 'N/A' : '—') : rounded.toFixed(1)}
          </span>
          {rounded !== null && unit && <span className="text-sm font-medium text-surface-400">{unit}</span>}
        </div>
      </div>
    </div>
  );
}
