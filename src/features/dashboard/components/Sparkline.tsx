import { useEffect, useRef, useState } from 'react';

const WIDTH = 120;
const HEIGHT = 32;
const PADDING = 4;

interface SparklineProps {
  values: number[];
  unavailable?: boolean;
}

// Minimal inline trend line for a single live-polled value. No axes/legend -
// a single series names itself via the tile it sits in; the point is shape
// (rising/falling/steady), not precise reading (the tile's own number does that).
export function Sparkline({ values, unavailable }: SparklineProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);
  const [drawn, setDrawn] = useState(false);

  const points =
    values.length >= 2
      ? (() => {
          const min = Math.min(...values);
          const max = Math.max(...values);
          const range = max - min || 1;
          return values.map((v, i) => ({
            x: PADDING + (i / (values.length - 1)) * (WIDTH - PADDING * 2),
            y: HEIGHT - PADDING - ((v - min) / range) * (HEIGHT - PADDING * 2),
          }));
        })()
      : [];

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Measure the path once it's rendered, then draw it in - CSS can't
  // interpolate an SVG `d` string, so a dash-offset reveal on mount is the
  // animation, and later value updates just redraw the (already-visible) line.
  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [path]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (points.length < 2) {
    return <div className="h-8" aria-hidden />;
  }

  const last = points[points.length - 1];
  const lineColor = unavailable ? 'var(--color-status-critical)' : 'var(--color-primary-500)';
  const dotColor = unavailable ? 'var(--color-status-critical)' : 'var(--color-primary)';

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full h-8"
      role="img"
      aria-label={`Trend: ${values.length} recent readings, latest ${values[values.length - 1]}`}
    >
      <path
        ref={pathRef}
        d={path}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{
          strokeDasharray: pathLength || undefined,
          strokeDashoffset: pathLength ? (drawn ? 0 : pathLength) : undefined,
          transition: 'stroke-dashoffset 600ms ease-out',
        }}
      />
      <circle cx={last.x} cy={last.y} r={4} fill={dotColor} stroke="white" strokeWidth={2} />
    </svg>
  );
}
