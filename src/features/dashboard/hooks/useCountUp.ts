import { useEffect, useState } from 'react';

// Tweens the displayed number toward `value` over `durationMs` instead of
// snapping on every poll update - purely a display animation, the real
// value is still what's used everywhere else.
export function useCountUp(value: number | null, durationMs = 500): number | null {
  const [displayed, setDisplayed] = useState(value);
  const [animateFrom, setAnimateFrom] = useState(value);

  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setAnimateFrom(prevValue === null ? value : displayed);
    setPrevValue(value);
  }

  useEffect(() => {
    if (value === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayed(null);
      return;
    }
    const from = animateFrom ?? value;
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplayed(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return displayed;
}
