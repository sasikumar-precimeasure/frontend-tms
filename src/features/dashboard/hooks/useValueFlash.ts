import { useEffect, useState } from 'react';

// Briefly flags `true` whenever `value` actually changes (not on every
// render/poll tick with the same value) - drives a highlight animation so a
// live update is visible without flickering every second at rest.
export function useValueFlash(value: unknown): boolean {
  const [previous, setPrevious] = useState(value);
  const [flashing, setFlashing] = useState(false);
  const changed = previous !== value;

  if (changed) {
    setPrevious(value);
  }

  useEffect(() => {
    if (!changed || value === null || value === undefined) return;
    // Starts a timer-driven highlight that clears itself; not a render-loop risk.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlashing(true);
    const timeout = setTimeout(() => setFlashing(false), 900);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previous]);

  return flashing;
}
