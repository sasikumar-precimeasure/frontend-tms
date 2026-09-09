import { useState } from 'react';

const MAX_POINTS = 30;

// Tracks the last N values of a live-polled number for an inline sparkline.
// Local component state (not Redux) - this is ephemeral display history, not
// domain state anything else needs.
export function useHistory(value: number | null): number[] {
  const [history, setHistory] = useState<number[]>(() => (value !== null ? [value] : []));
  const last = history[history.length - 1];

  if (value !== null && value !== last) {
    setHistory((prev) => {
      const next = [...prev, value];
      return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
    });
  }

  return history;
}
