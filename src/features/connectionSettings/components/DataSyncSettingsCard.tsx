import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { setReadingsPushIntervalSeconds, MIN_READINGS_PUSH_INTERVAL_SECONDS } from '../slice';

// App-wide (not per-transformer) control for how often every device's
// latest reading is pushed to tms-backend for historical storage/audit/
// mail-threshold evaluation - see TmsAppLayout's readings-push effect,
// which reads connectionSettings.readingsPushIntervalSeconds directly.
// Lives at the top of Connection Settings' main panel (visible regardless
// of which transformer is selected) since it's the section most related to
// "how this app talks to the backend", even though the setting itself
// isn't scoped to one transformer.
export function DataSyncSettingsCard() {
  const dispatch = useAppDispatch();
  const intervalSeconds = useAppSelector((state) => state.connectionSettings.readingsPushIntervalSeconds);
  const [draftMinutes, setDraftMinutes] = useState(String(intervalSeconds / 60));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const minutes = Number(draftMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setError('Enter a number of minutes greater than 0');
      setSaved(false);
      return;
    }
    const seconds = Math.round(minutes * 60);
    if (seconds < MIN_READINGS_PUSH_INTERVAL_SECONDS) {
      setError(`Minimum is ${MIN_READINGS_PUSH_INTERVAL_SECONDS / 60} minute`);
      setSaved(false);
      return;
    }
    setError(null);
    dispatch(setReadingsPushIntervalSeconds(seconds));
    setDraftMinutes(String(seconds / 60));
    setSaved(true);
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">Data Sync</p>
        <p className="text-xs text-surface-500 mt-0.5">
          How often the gateway service sends every device's latest reading to the backend for history, monthly
          reports and alarm emails - applies to all transformers, and keeps running with this page minimized or closed.
        </p>
      </div>
      <div className="px-4 py-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Push interval (minutes)</label>
          <input
            type="number"
            min={MIN_READINGS_PUSH_INTERVAL_SECONDS / 60}
            step={1}
            value={draftMinutes}
            onChange={(e) => {
              setDraftMinutes(e.target.value);
              setSaved(false);
            }}
            className="w-28 px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>
        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition"
        >
          Save
        </button>
        {saved && <span className="text-xs font-medium text-status-good">Saved</span>}
        <span className="text-xs text-surface-400">Minimum {MIN_READINGS_PUSH_INTERVAL_SECONDS / 60} minute</span>
      </div>
      {error && <p className="px-4 pb-3 -mt-1 text-[11px] text-status-critical">{error}</p>}
      <PushStatus />
    </div>
  );
}

// Whether the pushes are actually landing - a failing push otherwise only
// shows up later as gaps in the Data Log / monthly report.
function PushStatus() {
  const { lastAttemptAt, lastSuccessAt, lastError, failuresInARow, serviceUnreachable } = useAppSelector(
    (state) => state.readingsPush
  );
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString() : 'never');

  if (serviceUnreachable) {
    return (
      <div className="mx-4 mb-3 px-3 py-2 rounded-md bg-status-critical-soft text-status-critical text-xs">
        <p className="font-semibold">{serviceUnreachable}</p>
        <p className="mt-0.5">Nothing is being read or saved until it runs again - start it with "npm run dev:setup".</p>
      </div>
    );
  }
  if (!lastAttemptAt) {
    return <p className="px-4 pb-3 text-xs text-surface-500">Last sync: waiting for the first push…</p>;
  }
  if (!lastError) {
    return <p className="px-4 pb-3 text-xs text-status-good font-medium">Last sync: OK at {time(lastSuccessAt)}</p>;
  }
  return (
    <div className="mx-4 mb-3 px-3 py-2 rounded-md bg-status-critical-soft text-status-critical text-xs">
      <p className="font-semibold">
        Last sync failed at {time(lastAttemptAt)}
        {failuresInARow > 1 ? ` (${failuresInARow} times in a row)` : ''} - readings are not being saved to history.
      </p>
      <p className="mt-0.5">{lastError}</p>
      <p className="mt-0.5 text-surface-500">Last successful sync: {time(lastSuccessAt)}</p>
    </div>
  );
}
