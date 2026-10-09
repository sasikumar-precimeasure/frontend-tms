import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { MonthlyReportRecipient, MonthlyReportSettings } from '../../../domain/entities/MonthlyReport';
import {
  fetchMonthlyReportAsync,
  saveMonthlyReportSettingsAsync,
  saveMonthlyReportRecipientAsync,
  deleteMonthlyReportRecipientAsync,
  downloadMonthlyReportAsync,
  sendMonthlyReportNowAsync,
} from '../../monthlyReport/slice';
import { showToast } from '../../toast/slice';
import { useCanWrite } from '../../../shared/hooks/usePermissions';
import { WriteGate } from '../../../shared/components/WriteGate';

const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1);

// Common plant zones first; whatever is saved is always kept selectable.
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'UTC'];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function previousMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

// Schedule: on/off, which day + time the previous month's report goes out.
function ScheduleSection() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((state) => state.monthlyReport.settings);
  const [draft, setDraft] = useState<MonthlyReportSettings>(settings);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset-on-change pattern used across this codebase (see SenderSettingsSection).
  const [prevSettings, setPrevSettings] = useState(settings);
  if (prevSettings !== settings) {
    setPrevSettings(settings);
    setDraft(settings);
  }

  const zones = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [draft.timezone, ...TIMEZONES];

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await dispatch(saveMonthlyReportSettingsAsync(draft)).unwrap();
      dispatch(showToast('Monthly report schedule saved'));
    } catch (message) {
      setError(typeof message === 'string' ? message : 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">Monthly Report</p>
        <p className="text-xs text-surface-500 mt-0.5">
          Every month, the previous month&apos;s readings for every device are averaged into 30-minute slots (with OTI/WTI
          peaks) and emailed as an Excel report to the recipients below.
        </p>
      </div>
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div className="flex items-center gap-2 pb-1.5">
          <input
            type="checkbox"
            id="monthly-report-enabled"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
          <label htmlFor="monthly-report-enabled" className="text-sm text-surface-700 font-medium">
            Send automatically
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Day of month</label>
          <select
            value={draft.dayOfMonth}
            onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })}
            className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0"
          >
            {DAYS_OF_MONTH.map((day) => (
              <option key={day} value={day}>
                {ordinal(day)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Send time</label>
          <input
            type="time"
            value={draft.sendTime}
            onChange={(e) => setDraft({ ...draft, sendTime: e.target.value })}
            className="w-full px-2.5 py-1.5 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Time zone</label>
          <select
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="px-4 pb-3 text-xs text-surface-500 space-y-1">
        <p>
          {draft.enabled
            ? `Sends on the ${ordinal(draft.dayOfMonth)} of every month at ${draft.sendTime} (${draft.timezone}), covering the previous month.`
            : 'Automatic sending is off - you can still download or send a report manually below.'}
        </p>
        {draft.enabled && !settings.enabled && (
          <p>
            If this month&apos;s send time has already passed, last month&apos;s report goes out within a minute of saving.
          </p>
        )}
        <p>
          Last sent automatically:{' '}
          <span className="font-medium text-surface-700">
            {settings.lastSentPeriod && settings.lastSentAt
              ? `${formatPeriod(settings.lastSentPeriod)} report, on ${new Date(settings.lastSentAt).toLocaleString()}`
              : 'never'}
          </span>
        </p>
      </div>
      {error && <p className="px-4 pb-2 text-[11px] text-status-critical">{error}</p>}
      <div className="px-4 py-3 border-t border-surface-100">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function RecipientRow({ recipient }: { recipient: MonthlyReportRecipient }) {
  const dispatch = useAppDispatch();

  const toggleEnabled = () => {
    dispatch(saveMonthlyReportRecipientAsync({ ...recipient, enabled: !recipient.enabled }))
      .unwrap()
      .then(() => dispatch(showToast(recipient.enabled ? 'Recipient disabled' : 'Recipient enabled')))
      .catch((message: unknown) => dispatch(showToast(typeof message === 'string' ? message : 'Update failed', 'error')));
  };

  const remove = () => {
    if (!window.confirm(`Remove ${recipient.email} from the monthly report?`)) return;
    dispatch(deleteMonthlyReportRecipientAsync({ id: recipient.id }))
      .unwrap()
      .then(() => dispatch(showToast('Recipient removed')))
      .catch(() => dispatch(showToast('Failed to remove recipient', 'error')));
  };

  return (
    <div className="py-2.5 border-b border-surface-100 last:border-0 flex flex-wrap items-center gap-3">
      <input
        type="checkbox"
        checked={recipient.enabled}
        onChange={toggleEnabled}
        title={recipient.enabled ? 'Receives the report' : 'Paused'}
        className="w-4 h-4 accent-primary"
      />
      <span className={`w-40 text-sm ${recipient.enabled ? 'text-surface-800' : 'text-surface-400'}`}>{recipient.name}</span>
      <span className={`flex-1 min-w-[200px] text-sm font-mono ${recipient.enabled ? 'text-surface-600' : 'text-surface-400'}`}>
        {recipient.email}
      </span>
      <button onClick={remove} className="text-xs text-surface-400 hover:text-status-critical">
        Remove
      </button>
    </div>
  );
}

// Report readers - a separate list from the alarm-email recipients above.
function RecipientsSection() {
  const dispatch = useAppDispatch();
  const recipients = useAppSelector((state) => state.monthlyReport.recipients);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (name.trim() === '') {
      setError('Please enter a name');
      return;
    }
    if (!isValidEmail(email.trim())) {
      setError('Please enter a valid email');
      return;
    }
    if (recipients.some((r) => r.email.toLowerCase() === email.trim().toLowerCase())) {
      setError('This email is already on the list');
      return;
    }
    setError(null);
    try {
      await dispatch(saveMonthlyReportRecipientAsync({ name: name.trim(), email: email.trim(), enabled: true })).unwrap();
      setName('');
      setEmail('');
      dispatch(showToast('Report recipient added'));
    } catch (message) {
      setError(typeof message === 'string' ? message : 'Failed to add recipient');
    }
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">Monthly Report Recipients</p>
        <p className="text-xs text-surface-500 mt-0.5">
          Separate from the alert recipients - everyone here gets the full report for all devices.
        </p>
      </div>
      <div className="px-4 py-3 border-b border-surface-100 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Recipient name"
            className="w-40 px-2.5 py-1.5 text-sm border border-surface-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            className="w-56 px-2.5 py-1.5 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition"
        >
          + Add Recipient
        </button>
        {error && <p className="text-[11px] text-status-critical basis-full">{error}</p>}
      </div>
      <div className="px-4">
        {recipients.length === 0 ? (
          <p className="py-4 text-sm text-surface-500">No report recipients yet - the scheduled report won&apos;t be sent until you add one.</p>
        ) : (
          recipients.map((recipient) => <RecipientRow key={recipient.id} recipient={recipient} />)
        )}
      </div>
    </div>
  );
}

// Manual generate: download any month's report, or email it right now
// (doesn't affect the automatic schedule).
function GenerateSection({ canSend }: { canSend: boolean }) {
  const dispatch = useAppDispatch();
  const [month, setMonth] = useState(previousMonth);
  const [busy, setBusy] = useState<'download' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'download' | 'send') => {
    if (!month) return;
    setError(null);
    setBusy(action);
    try {
      if (action === 'download') {
        await dispatch(downloadMonthlyReportAsync({ month })).unwrap();
      } else {
        const result = await dispatch(sendMonthlyReportNowAsync({ month })).unwrap();
        dispatch(showToast(`${formatPeriod(month)} report sent to ${result.recipientCount} recipient(s)`));
      }
    } catch (message) {
      setError(typeof message === 'string' ? message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">Generate Report Now</p>
        <p className="text-xs text-surface-500 mt-0.5">Download or email any month&apos;s report - handy for testing the setup.</p>
      </div>
      <div className="px-4 py-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-2.5 py-1.5 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
        <button
          onClick={() => run('download')}
          disabled={busy !== null || !month}
          className="px-3 py-1.5 text-xs font-semibold rounded-md border border-surface-300 text-surface-700 hover:bg-surface-50 transition disabled:opacity-50"
        >
          {busy === 'download' ? 'Preparing…' : 'Download Excel'}
        </button>
        <button
          onClick={() => run('send')}
          disabled={busy !== null || !month || !canSend}
          title={canSend ? undefined : 'Needs write permission on Monthly Report'}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition disabled:opacity-50"
        >
          {busy === 'send' ? 'Sending…' : 'Send to recipients now'}
        </button>
        {error && <p className="text-[11px] text-status-critical basis-full">{error}</p>}
      </div>
    </div>
  );
}

export const MonthlyReportCard = () => {
  const dispatch = useAppDispatch();
  // Read-only users may download reports, but not change or send them.
  const canWrite = useCanWrite('Monthly Report');
  const loaded = useAppSelector((state) => state.monthlyReport.loaded);
  const loadError = useAppSelector((state) => state.monthlyReport.loadError);

  useEffect(() => {
    dispatch(fetchMonthlyReportAsync());
  }, [dispatch]);

  if (loadError && !loaded) {
    return (
      <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">
        Couldn&apos;t load monthly report settings - is the backend reachable, and do you have permission?
      </div>
    );
  }
  if (!loaded) {
    return <div className="px-4 py-2.5 rounded-lg bg-surface-100 text-surface-500 text-sm font-medium">Loading monthly report…</div>;
  }

  return (
    <div className="space-y-4">
      <WriteGate menu="Monthly Report">
        <ScheduleSection />
        <RecipientsSection />
      </WriteGate>
      <GenerateSection canSend={canWrite} />
    </div>
  );
};
