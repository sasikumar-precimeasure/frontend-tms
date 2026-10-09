import { useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { fetchDataLogTopologyAsync, fetchDataLogPageAsync, exportDataLogAsync } from '../slice';
import type { IrtccDataLogRow, Device2243DataLogRow, PagedDataLog } from '../slice';

const PAGE_SIZE = 25;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNumber(value: number | null): string {
  return value === null || value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatBool(value: boolean | null): string {
  return value === null || value === undefined ? '—' : value ? 'Yes' : 'No';
}

const IRTCC_COLUMNS: { header: string; render: (r: IrtccDataLogRow) => string }[] = [
  { header: 'OTI °C', render: (r) => formatNumber(r.otiTemperature) },
  { header: 'WTI °C', render: (r) => formatNumber(r.wtiTemperature) },
  { header: 'MOG', render: (r) => formatNumber(r.mog) },
  { header: 'Tap Position', render: (r) => formatNumber(r.tapPosition) },
  { header: 'Tap Count', render: (r) => formatNumber(r.tapCount) },
  { header: 'PT Voltage', render: (r) => formatNumber(r.ptVoltage) },
  { header: 'Actual PT Voltage', render: (r) => formatNumber(r.actualPtVoltage) },
  { header: 'Mode', render: (r) => r.operationMode ?? '—' },
  { header: 'AVR Auto', render: (r) => formatBool(r.avrModeIsAuto) },
  { header: 'Control Fail', render: (r) => formatBool(r.controlFailActive) },
];

const DEVICE2243_COLUMNS: { header: string; render: (r: Device2243DataLogRow) => string }[] = [
  { header: 'OTI °C', render: (r) => formatNumber(r.otiTemperature) },
  { header: 'WTI °C', render: (r) => formatNumber(r.wtiTemperature) },
  { header: 'OTI Alarm Setpoint', render: (r) => formatNumber(r.otiAlarmSetpoint) },
  { header: 'OTI Trip Setpoint', render: (r) => formatNumber(r.otiTripSetpoint) },
  { header: 'WTI Alarm Setpoint', render: (r) => formatNumber(r.wtiAlarmSetpoint) },
  { header: 'WTI Trip Setpoint', render: (r) => formatNumber(r.wtiTripSetpoint) },
  { header: 'Relay Delay', render: (r) => formatNumber(r.relayDelay) },
];

// Settings > Data Log - browses and exports the historical readings the
// 1-minute ingestion push has stored (see TmsAppLayout's readings-push
// effect and tms-backend's ReadingIngestController). Visual structure
// deliberately mirrors AuditLogCard.tsx (stat tiles, card header +
// Refresh, filter bar, hand-rolled <table>, centered empty/loading states)
// for design consistency between the two "Settings" read-only log screens.
// A pure read/export screen: pick a Transformer, then one of its devices, a
// date range, then page through that device's stored rows or export the
// whole range as one .xlsx workbook. Column set adapts to the selected
// device's type (IRTCC vs 2243), since their stored fields are entirely
// different.
export function DataLogPage() {
  const dispatch = useAppDispatch();
  const transformers = useAppSelector((state) => state.dataLog.transformers);
  const topologyLoaded = useAppSelector((state) => state.dataLog.topologyLoaded);
  const configuredTransformers = useAppSelector((state) => state.connectionSettings.transformers);

  // The backend keeps every transformer any browser has ever pushed, so
  // earlier setups (or another browser's settings) leave same-named entries
  // behind - e.g. four "TR1 7.5 MVA", only one of which still gets data.
  // List the transformers configured in this browser first (in Settings
  // order) and everything else separately as "old", so the default and the
  // obvious choice are the ones actually receiving readings.
  const { currentTransformers, oldTransformers } = useMemo(() => {
    const backendById = new Map(transformers.map((tr) => [tr.id, tr]));
    const current = configuredTransformers.flatMap((tr) => backendById.get(tr.id) ?? []);
    const currentIds = new Set(current.map((tr) => tr.id));
    return { currentTransformers: current, oldTransformers: transformers.filter((tr) => !currentIds.has(tr.id)) };
  }, [transformers, configuredTransformers]);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTrId, setSelectedTrId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(daysAgoIso(7));
  const [toDate, setToDate] = useState(todayIso());
  const [dateError, setDateError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<PagedDataLog<IrtccDataLogRow> | PagedDataLog<Device2243DataLogRow> | null>(null);

  useEffect(() => {
    dispatch(fetchDataLogTopologyAsync())
      .unwrap()
      .catch(() => setLoadError('Could not load transformers - is the backend reachable, and do you have the "Data Log" permission?'));
  }, [dispatch]);

  const selectedTr = transformers.find((tr) => tr.id === selectedTrId);
  const deviceOptions = useMemo(
    () => selectedTr?.gateways.flatMap((gw) => gw.devices.map((d) => ({ ...d, gatewayName: gw.name }))) ?? [],
    [selectedTr]
  );
  const selectedDevice = deviceOptions.find((d) => d.id === selectedDeviceId);

  // Auto-select the first transformer/device once the topology loads, so
  // the screen isn't just an empty shell on first visit.
  const [autoSelected, setAutoSelected] = useState(false);
  if (topologyLoaded && !autoSelected) {
    const first = currentTransformers[0] ?? oldTransformers[0];
    if (first && selectedTrId === '') {
      setSelectedTrId(first.id);
    }
    setAutoSelected(true);
  }

  // load() takes the device explicitly rather than closing over
  // `selectedDevice` (derived from selectedDeviceId state) - a caller that
  // just called setSelectedDeviceId(...) would otherwise read the stale
  // pre-update value, since the derived `selectedDevice` doesn't reflect a
  // state update until the next render.
  const load = (device: { id: string; deviceType: 'IRTCC' | 'DEVICE_2243' } | undefined, targetPage: number) => {
    if (!device) return;
    if (fromDate > toDate) {
      setDateError('"From" date must be on or before "To" date');
      return;
    }
    setDateError(null);
    setIsLoadingRows(true);
    setRowsError(null);
    dispatch(
      fetchDataLogPageAsync({
        deviceId: device.id,
        deviceType: device.deviceType,
        from: new Date(`${fromDate}T00:00:00`).toISOString(),
        to: new Date(`${toDate}T23:59:59.999`).toISOString(),
        page: targetPage,
        pageSize: PAGE_SIZE,
      })
    )
      .unwrap()
      .then((payload) => {
        setResult(payload);
        setPage(targetPage);
      })
      .catch(() => setRowsError('Could not load readings - is the backend reachable, and do you have permission?'))
      .finally(() => setIsLoadingRows(false));
  };

  // Reset the device selection (and load its first page) whenever the
  // transformer changes - detected via a previous-value comparison during
  // render (this codebase's sanctioned pattern for reset-on-change state,
  // see AnnunciationPanel.tsx) rather than an effect, since dispatching a
  // Redux action or calling setState from inside a useEffect body is what
  // the lint rule this pattern exists to satisfy actually flags.
  const [prevSelectedTrId, setPrevSelectedTrId] = useState(selectedTrId);
  if (prevSelectedTrId !== selectedTrId) {
    setPrevSelectedTrId(selectedTrId);
    const firstDevice = transformers.find((tr) => tr.id === selectedTrId)?.gateways.flatMap((gw) => gw.devices)[0];
    setSelectedDeviceId(firstDevice?.id ?? '');
    setPage(1);
    setResult(null);
    if (firstDevice) load(firstDevice, 1);
  }

  const handleSelectDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setPage(1);
    setResult(null);
    const device = deviceOptions.find((d) => d.id === deviceId);
    if (device) load(device, 1);
  };

  const handleApplyDateRange = () => load(selectedDevice, 1);

  const handleClearFilters = () => {
    setSearch('');
    setFromDate(daysAgoIso(7));
    setToDate(todayIso());
    setDateError(null);
  };

  const handleExport = async () => {
    if (!selectedDevice) return;
    if (fromDate > toDate) {
      setDateError('"From" date must be on or before "To" date');
      return;
    }
    setIsExporting(true);
    try {
      await dispatch(
        exportDataLogAsync({
          deviceId: selectedDevice.id,
          deviceType: selectedDevice.deviceType,
          from: new Date(`${fromDate}T00:00:00`).toISOString(),
          to: new Date(`${toDate}T23:59:59.999`).toISOString(),
          deviceName: selectedDevice.name,
        })
      ).unwrap();
    } catch {
      setRowsError('Export failed - is the backend reachable, and do you have permission?');
    } finally {
      setIsExporting(false);
    }
  };

  const isIrtcc = selectedDevice?.deviceType === 'IRTCC';
  const columns = isIrtcc ? IRTCC_COLUMNS : DEVICE2243_COLUMNS;
  const allRows = (result?.items ?? []) as (IrtccDataLogRow | Device2243DataLogRow)[];

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return allRows;
    return allRows.filter((row) => {
      const haystack = [formatTimestamp(row.recordedAt), ...columns.map((c) => c.render(row as never))].join(' ').toLowerCase();
      return haystack.includes(query);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, search, isIrtcc]);

  const hasActiveFilters = search !== '' || fromDate !== daysAgoIso(7) || toDate !== todayIso();

  return (
    <div className="min-h-screen bg-surface-100">
      <header className="px-6 py-5 bg-surface-0 border-b border-surface-200">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Settings</p>
        <h1 className="text-xl font-semibold text-surface-900">Data Log</h1>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {loadError && (
          <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">{loadError}</div>
        )}
        {rowsError && (
          <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">{rowsError}</div>
        )}

        {result && result.items.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-sm px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">Total Readings</p>
              <p className="text-2xl font-bold text-surface-900 mt-1 tabular-nums">{result.totalItems.toLocaleString()}</p>
            </div>
            <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-sm px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">Showing</p>
              <p className="text-2xl font-bold text-surface-900 mt-1 tabular-nums">{filteredRows.length}</p>
            </div>
          </div>
        )}

        <div className="bg-surface-0 rounded-xl border border-surface-200 shadow-sm overflow-hidden animate-panel-enter">
          <div className="px-4 py-3.5 bg-surface-50 border-b border-surface-200 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold text-surface-800">Data Log</p>
              <p className="text-xs text-surface-500 mt-0.5">
                Historical readings captured every minute for the selected transformer/device, over a date range.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleExport}
                disabled={!selectedDevice || isExporting}
                className="text-xs font-semibold text-primary hover:text-primary-700 disabled:opacity-40 disabled:pointer-events-none"
              >
                {isExporting ? 'Exporting…' : '⭳ Export to Excel'}
              </button>
              <button
                onClick={() => load(selectedDevice, page)}
                disabled={!selectedDevice}
                className="text-xs font-semibold text-primary hover:text-primary-700 disabled:opacity-40 disabled:pointer-events-none"
              >
                ↻ Refresh
              </button>
            </div>
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
                  placeholder="Search this page's readings…"
                  className="w-56 pl-8 pr-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Transformer</label>
              <select
                value={selectedTrId}
                onChange={(e) => setSelectedTrId(e.target.value)}
                className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">Select a transformer…</option>
                {currentTransformers.length > 0 && (
                  <optgroup label="Configured in Settings">
                    {currentTransformers.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {oldTransformers.length > 0 && (
                  <optgroup label="Older setups (no longer in Settings)">
                    {oldTransformers.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.name} (old)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Device</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => handleSelectDevice(e.target.value)}
                disabled={deviceOptions.length === 0}
                className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-50"
              >
                <option value="">Select a device…</option>
                {deviceOptions.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.gatewayName} — {device.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">From</label>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">To</label>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-1.5 text-sm border border-surface-300 rounded-md bg-surface-0 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <button
              onClick={handleApplyDateRange}
              disabled={!selectedDevice}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition disabled:opacity-50"
            >
              Apply
            </button>
            {hasActiveFilters && (
              <button onClick={handleClearFilters} className="text-xs font-semibold text-surface-500 hover:text-surface-700 pb-1.5">
                Clear filters
              </button>
            )}
          </div>
          {dateError && <p className="px-4 pb-2 -mt-1 text-[11px] text-status-critical">{dateError}</p>}

          {!selectedDevice ? (
            <p className="py-10 px-4 text-sm text-surface-500 text-center">
              {topologyLoaded && transformers.length === 0
                ? 'No transformers configured yet.'
                : 'Select a transformer and device to view its data log.'}
            </p>
          ) : isLoadingRows ? (
            <p className="py-10 px-4 text-sm text-surface-500 text-center">Loading…</p>
          ) : filteredRows.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <p className="text-sm font-medium text-surface-600">
                {allRows.length === 0 ? 'No readings stored for this range.' : 'No readings match your search.'}
              </p>
              {allRows.length > 0 && search !== '' && (
                <button onClick={() => setSearch('')} className="mt-2 text-sm font-semibold text-primary hover:text-primary-700">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-surface-500 bg-surface-50/60">
                    <th className="py-2 px-4 font-medium whitespace-nowrap">Time</th>
                    {columns.map((col) => (
                      <th key={col.header} className="py-2 px-4 font-medium whitespace-nowrap">
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr key={`${row.recordedAt}-${i}`} className="border-t border-surface-100 hover:bg-surface-50/60 transition-colors">
                      <td className="py-2.5 px-4 text-xs font-mono text-surface-500 whitespace-nowrap">
                        {formatTimestamp(row.recordedAt)}
                      </td>
                      {columns.map((col) => (
                        <td key={col.header} className="py-2.5 px-4 text-sm text-surface-800 whitespace-nowrap">
                          {col.render(row as never)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result && result.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-surface-100 flex items-center justify-between">
              <p className="text-xs text-surface-500">
                Page {result.page} of {result.totalPages} — {result.totalItems.toLocaleString()} total readings
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => load(selectedDevice, page - 1)}
                  disabled={page <= 1 || isLoadingRows}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md border border-surface-300 text-surface-600 hover:bg-surface-50 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => load(selectedDevice, page + 1)}
                  disabled={page >= result.totalPages || isLoadingRows}
                  className="px-2.5 py-1 text-xs font-semibold rounded-md border border-surface-300 text-surface-600 hover:bg-surface-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DataLogPage;
