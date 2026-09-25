import { useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { AuditEvent, AuditEventType } from '../slice';
import { fetchAuditEventsAsync } from '../slice';
import { fetchUsersAndRolesAsync } from '../../users/slice';

// Human-readable label per event type - mirrors
// com.tmsbackend.domain.model.AuditEventType exactly.
const EVENT_TYPE_LABELS: Record<AuditEventType, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  ANNUNCIATION_ACK: 'Annunciation Ack',
  AVR_MODE_CHANGE: 'AVR Mode Change',
  TAP_RAISE: 'Tap Raise',
  TAP_LOWER: 'Tap Lower',
  CONTROL_FAIL_RESET: 'Control Fail Reset',
  AVR_SETTING_CHANGE: 'AVR Setting Change',
  DEVICE2243_SETPOINT_CHANGE: '2243 Setpoint Change',
  MAIL_CONFIG_CHANGE: 'Mail Config Change',
  THRESHOLD_BREACH: 'Threshold Breach',
  MAIL_SENT: 'Mail Sent',
  USER_CREATED: 'User Created',
  USER_UPDATED: 'User Updated',
  USER_STATUS_CHANGED: 'User Status Changed',
  USER_DELETED: 'User Deleted',
  ROLE_CREATED: 'Role Created',
  ROLE_DELETED: 'Role Deleted',
};

// Tone groups: user-initiated device writes (blue), mail/threshold system
// events (amber - something the system did on its own), user-management
// events (surface/neutral).
const EVENT_TYPE_TONE: Record<AuditEventType, string> = {
  LOGIN: 'bg-surface-100 text-surface-600',
  LOGOUT: 'bg-surface-100 text-surface-600',
  ANNUNCIATION_ACK: 'bg-primary/10 text-primary',
  AVR_MODE_CHANGE: 'bg-primary/10 text-primary',
  TAP_RAISE: 'bg-primary/10 text-primary',
  TAP_LOWER: 'bg-primary/10 text-primary',
  CONTROL_FAIL_RESET: 'bg-primary/10 text-primary',
  AVR_SETTING_CHANGE: 'bg-primary/10 text-primary',
  DEVICE2243_SETPOINT_CHANGE: 'bg-primary/10 text-primary',
  MAIL_CONFIG_CHANGE: 'bg-surface-100 text-surface-600',
  THRESHOLD_BREACH: 'bg-status-warn-soft text-status-warn',
  MAIL_SENT: 'bg-status-good-soft text-status-good',
  USER_CREATED: 'bg-surface-100 text-surface-600',
  USER_UPDATED: 'bg-surface-100 text-surface-600',
  USER_STATUS_CHANGED: 'bg-surface-100 text-surface-600',
  USER_DELETED: 'bg-status-critical-soft text-status-critical',
  ROLE_CREATED: 'bg-surface-100 text-surface-600',
  ROLE_DELETED: 'bg-status-critical-soft text-status-critical',
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// USER_STATUS_CHANGED stores the raw boolean (enabled/disabled) as
// String.valueOf(boolean) on the backend - "true"/"false" read as gibberish
// in the UI, so translate that one field to the status wording the rest of
// the Users screen uses. Every other event type's old/new values (AVR modes,
// numeric setpoints, etc.) are already human-readable as-is.
function formatChangeValue(event: AuditEvent, value: string): string {
  if (event.eventType === 'USER_STATUS_CHANGED' && (value === 'true' || value === 'false')) {
    return value === 'true' ? 'Active' : 'Inactive';
  }
  return value;
}

function AuditEventTableRow({ event, actorName }: { event: AuditEvent; actorName: string }) {
  return (
    <tr className="border-t border-surface-100 hover:bg-surface-50/60 transition-colors align-top">
      <td className="py-2.5 px-4 text-xs font-mono text-surface-500 whitespace-nowrap">{formatTimestamp(event.occurredAt)}</td>
      <td className="py-2.5 px-4">
        <span
          className={`inline-block px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-full whitespace-nowrap ${EVENT_TYPE_TONE[event.eventType]}`}
        >
          {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
        </span>
      </td>
      <td className="py-2.5 px-4 text-xs font-medium text-surface-600 whitespace-nowrap">{actorName}</td>
      <td className="py-2.5 px-4 text-sm text-surface-800">
        {event.description}
        {(event.oldValue !== null || event.newValue !== null) && (
          <p className="mt-0.5 text-xs text-surface-500 font-mono">
            {event.fieldName && <span className="text-surface-400">{event.fieldName}: </span>}
            {event.oldValue !== null ? formatChangeValue(event, event.oldValue) : '—'}{' '}
            <span className="text-surface-300">→</span>{' '}
            {event.newValue !== null ? formatChangeValue(event, event.newValue) : '—'}
          </p>
        )}
      </td>
    </tr>
  );
}

// Settings > Audit Log - a read-only viewer over tms-backend's audit_events
// table (see AuditEventController.recent/byDevice). Every write this app
// makes to a device register, mail configuration, or user account posts
// here via recordAuditEventAsync - this screen is just the read side.
export function AuditLogCard() {
  const dispatch = useAppDispatch();
  const events = useAppSelector((state) => state.auditLog.events);
  const isLoaded = useAppSelector((state) => state.auditLog.isLoaded);
  const users = useAppSelector((state) => state.users.users);
  const transformers = useAppSelector((state) => state.connectionSettings.transformers);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<AuditEventType | ''>('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);

  const deviceOptions = useMemo(
    () =>
      transformers.flatMap((tr) =>
        tr.gateways.flatMap((gw) =>
          gw.subDevices.map((device) => ({ id: device.id, label: `${tr.name} — ${gw.name} — ${device.name}` }))
        )
      ),
    [transformers]
  );

  const deviceNameById = useMemo(() => new Map(deviceOptions.map((d) => [d.id, d.label])), [deviceOptions]);
  const userNameById = useMemo(() => new Map(users.map((u) => [u.id, u.userName])), [users]);

  // `to` is widened to the end of that calendar day (23:59:59.999) - the
  // <input type="date"> value is just a day with no time, and the backend's
  // range query is an inclusive-instant BETWEEN, so passing the day's own
  // midnight as `to` would exclude every event that happened later that same
  // day.
  const load = (deviceId?: string, from?: string, to?: string) => {
    const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
    const toIso = to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined;
    dispatch(fetchAuditEventsAsync({ deviceId: deviceId || undefined, from: fromIso, to: toIso }))
      .unwrap()
      .then(() => setLoadError(null))
      .catch(() => setLoadError('Could not load the audit log - is the backend reachable, and do you have the "Audit Log" permission?'));
  };

  useEffect(() => {
    load();
    // Resolving "who did this" needs the user list too - a 403 here (no
    // Users permission) just means actor names fall back to "User #<id>",
    // not a hard failure for this screen.
    dispatch(fetchUsersAndRolesAsync()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const handleFilterByDevice = (deviceId: string) => {
    setDeviceFilter(deviceId);
    load(deviceId, fromDate, toDate);
  };

  const handleApplyDateRange = () => {
    if (fromDate && toDate && fromDate > toDate) {
      setDateError('"From" date must be on or before "To" date');
      return;
    }
    setDateError(null);
    load(deviceFilter, fromDate, toDate);
  };

  const handleClearDateRange = () => {
    setFromDate('');
    setToDate('');
    setDateError(null);
    load(deviceFilter, '', '');
  };

  const actorLabel = (event: AuditEvent): string => {
    if (event.userId === null) return 'System';
    return userNameById.get(event.userId) ?? `User #${event.userId}`;
  };

  const deviceLabel = (deviceId: string): string => deviceNameById.get(deviceId) ?? deviceId;

  const filteredEvents = useMemo(() => {
    let result = typeFilter ? events.filter((e) => e.eventType === typeFilter) : events;
    const query = search.trim().toLowerCase();
    if (query !== '') {
      result = result.filter((e) => {
        const haystack = [
          e.description,
          e.fieldName ?? '',
          actorLabel(e),
          e.deviceId ? deviceLabel(e.deviceId) : '',
          EVENT_TYPE_LABELS[e.eventType],
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, typeFilter, search, userNameById, deviceNameById]);

  const hasActiveFilters = search !== '' || deviceFilter !== '' || typeFilter !== '' || fromDate !== '' || toDate !== '';

  const clearFilters = () => {
    setSearch('');
    setTypeFilter('');
    setDeviceFilter('');
    setFromDate('');
    setToDate('');
    setDateError(null);
    load('', '', '');
  };

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">{loadError}</div>
      )}

      {isLoaded && events.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-sm px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">Total Events</p>
            <p className="text-2xl font-bold text-surface-900 mt-1 tabular-nums">{events.length}</p>
          </div>
          <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-sm px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">Showing</p>
            <p className="text-2xl font-bold text-surface-900 mt-1 tabular-nums">{filteredEvents.length}</p>
          </div>
        </div>
      )}

      <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-sm overflow-hidden animate-panel-enter">
        <div className="px-4 py-3.5 bg-surface-50 border-b border-surface-200 flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold text-surface-800">Audit Log</p>
            <p className="text-xs text-surface-500 mt-0.5">
              Every annunciation ack, AVR change, mail configuration edit, and user management action, with who did it.
            </p>
          </div>
          <button
            onClick={() => load(deviceFilter, fromDate, toDate)}
            className="text-xs font-semibold text-primary hover:text-primary-700"
          >
            ↻ Refresh
          </button>
        </div>

        <div className="px-4 py-3 border-b border-surface-100 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Search</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none">
                <svg viewBox="0 0 20 20" width={16} height={16} fill="none" aria-hidden>
                  <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M14 14l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description, field, actor, device…"
                className="w-64 pl-8 pr-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Device</label>
            <select
              value={deviceFilter}
              onChange={(e) => handleFilterByDevice(e.target.value)}
              className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">All devices</option>
              {deviceOptions.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Event Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as AuditEventType | '')}
              className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">All event types</option>
              {(Object.keys(EVENT_TYPE_LABELS) as AuditEventType[]).map((type) => (
                <option key={type} value={type}>
                  {EVENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <button
            onClick={handleApplyDateRange}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition"
          >
            Apply
          </button>
          {(fromDate !== '' || toDate !== '') && (
            <button onClick={handleClearDateRange} className="text-xs font-semibold text-surface-500 hover:text-surface-700 pb-1.5">
              Clear dates
            </button>
          )}
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-xs font-semibold text-surface-500 hover:text-surface-700 pb-1.5">
              Clear filters
            </button>
          )}
        </div>
        {dateError && <p className="px-4 pb-2 -mt-1 text-[11px] text-status-critical">{dateError}</p>}

        {!isLoaded && !loadError ? (
          <p className="py-10 px-4 text-sm text-surface-500 text-center">Loading…</p>
        ) : filteredEvents.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <p className="text-sm font-medium text-surface-600">
              {events.length === 0 ? 'No audit events yet.' : 'No audit events match your filters.'}
            </p>
            {events.length > 0 && hasActiveFilters && (
              <button onClick={clearFilters} className="mt-2 text-sm font-semibold text-primary hover:text-primary-700">
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-surface-500 bg-surface-50/60">
                  <th className="py-2 px-4 font-medium">Time</th>
                  <th className="py-2 px-4 font-medium">Event</th>
                  <th className="py-2 px-4 font-medium">Actor</th>
                  <th className="py-2 px-4 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <AuditEventTableRow
                    key={event.id}
                    event={{
                      ...event,
                      description:
                        event.deviceId && !deviceFilter ? `${deviceLabel(event.deviceId)} — ${event.description}` : event.description,
                    }}
                    actorName={actorLabel(event)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
