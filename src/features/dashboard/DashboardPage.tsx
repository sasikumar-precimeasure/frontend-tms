import { useRef, useState, useEffect, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/store/hooks';
import { selectTr } from '../connectionSettings/slice';
import { DevicePanel } from './components/DevicePanel';

const DashboardPage = () => {
  const dispatch = useAppDispatch();
  const { transformers, selectedTrId: persistedSelectedTrId } = useAppSelector(
    (state) => state.connectionSettings
  );
  const { user } = useAppSelector((state) => state.auth);
  const anyReading = useAppSelector((state) =>
    Object.values(state.dashboard.readingsByTrId).some((r) => r.isReading)
  );

  // The slice's selectedTrId is the persisted, cross-reload source of truth;
  // fall back to the first transformer only if it's missing/stale (e.g. that
  // TR was removed since the last save).
  const selectedTrId =
    transformers.some((tr) => tr.id === persistedSelectedTrId) ? persistedSelectedTrId : (transformers[0]?.id ?? '');
  const setSelectedTrId = (trId: string) => dispatch(selectTr(trId));
  const selectedTr = transformers.find((tr) => tr.id === selectedTrId) ?? transformers[0];
  const devices = selectedTr?.subDevices.filter((d) => d.enabled) ?? [];

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset to the first device whenever the selected TR changes - derived
  // during render (the sanctioned pattern for resetting state on a prop/id
  // change) rather than an effect, since it's not synchronizing with an
  // external system.
  const [trIdForIndex, setTrIdForIndex] = useState(selectedTrId);
  if (trIdForIndex !== selectedTrId) {
    setTrIdForIndex(selectedTrId);
    setActiveIndex(0);
  }

  const scrollToIndex = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const clamped = Math.max(0, Math.min(index, scroller.children.length - 1));
    const page = scroller.children[clamped] as HTMLElement | undefined;
    page?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      const index = Math.round(scroller.scrollLeft / scroller.clientWidth);
      setActiveIndex(index);
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, []);

  // Jump the scroller back to the start whenever the TR changes - a real DOM
  // side effect (imperative scroll), so this one genuinely belongs in an effect.
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0 });
  }, [selectedTrId]);

  const activeDevice = devices[activeIndex];

  return (
    <div className="h-screen flex flex-col bg-surface-100 ambient-glow overflow-hidden">
      <header className="shrink-0 flex items-center justify-between gap-4 px-6 py-3 bg-surface-0 border-b border-surface-200 shadow-sm animate-panel-enter stagger-1">
        <div className="flex items-center gap-3 min-w-0">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 shrink-0">
            Transformer
          </label>
          <div className="status-ring" data-status={selectedTr?.status ?? 'disconnected'}>
            <select
              value={selectedTrId}
              onChange={(e) => setSelectedTrId(e.target.value)}
              className="min-w-0 px-3 py-1.5 text-sm font-semibold text-surface-900 border border-surface-300 rounded-md bg-surface-0"
            >
              {transformers.length === 0 && <option value="">No transformer configured</option>}
              {transformers.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => scrollToIndex(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous device"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-surface-300 text-surface-600 hover:bg-surface-50 hover:border-surface-400 disabled:opacity-30 disabled:pointer-events-none transition"
          >
            &#8592;
          </button>

          <p className="text-sm font-medium text-surface-700 truncate min-w-0">
            {devices.length > 0 ? activeDevice?.name : 'No devices'}
          </p>

          <button
            onClick={() => scrollToIndex(activeIndex + 1)}
            disabled={activeIndex >= devices.length - 1}
            aria-label="Next device"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-surface-300 text-surface-600 hover:bg-surface-50 hover:border-surface-400 disabled:opacity-30 disabled:pointer-events-none transition"
          >
            &#8594;
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {devices.map((device, i) => (
            <button
              key={device.id}
              onClick={() => scrollToIndex(i)}
              aria-label={`Go to ${device.name}`}
              className={`h-1.5 rounded-full transition-all ${
                i === activeIndex ? 'w-6 bg-primary' : 'w-1.5 bg-surface-300 hover:bg-surface-400'
              }`}
            />
          ))}
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        {!selectedTr && (
          <div className="w-full flex items-center justify-center">
            <div className="text-center max-w-sm">
              <p className="text-surface-700 font-medium mb-1">No transformers configured</p>
              <p className="text-sm text-surface-500">
                Add one from Settings &rarr; Connection Settings to start monitoring.
              </p>
            </div>
          </div>
        )}
        {selectedTr && devices.length === 0 && (
          <div className="w-full flex items-center justify-center">
            <div className="text-center max-w-sm">
              <p className="text-surface-700 font-medium mb-1">No devices configured</p>
              <p className="text-sm text-surface-500">
                Add or enable a device for {selectedTr.name} in Settings &rarr; Connection Settings.
              </p>
            </div>
          </div>
        )}
        {selectedTr &&
          devices.map((device) => (
            <div key={device.id} className="w-full h-full shrink-0 snap-start overflow-y-auto">
              <DevicePanel
                trId={selectedTr.id}
                clientId={selectedTr.clientId}
                isConnected={selectedTr.isConnected}
                device={device}
              />
            </div>
          ))}
      </div>

      <footer className="shrink-0 flex items-center justify-between px-6 py-2.5 bg-surface-0 border-t border-surface-200 text-sm animate-panel-enter stagger-4">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full transition-colors duration-300 ${selectedTr?.isConnected ? 'bg-status-good text-status-good animate-breathe status-glow' : 'bg-surface-300'}`}
          />
          <span className="text-surface-600">{selectedTr?.isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div className="flex items-center gap-3">
          {anyReading && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary text-primary animate-pulse status-glow" />
              Reading
            </span>
          )}
          <span className="text-surface-500">{user?.fullName ?? user?.userName ?? 'Operator'}</span>
        </div>
      </footer>
    </div>
  );
};

export default DashboardPage;
