import { useRef, useState, useEffect, useCallback } from 'react';
import { useAppSelector } from '../../app/store/hooks';
import { TransformerPanel } from './components/TransformerPanel';

const DashboardPage = () => {
  const { transformers, gateways } = useAppSelector((state) => state.connectionSettings);
  const { user } = useAppSelector((state) => state.auth);
  const anyReading = useAppSelector((state) =>
    Object.values(state.dashboard.readingsByTrId).some((r) => r.isReading)
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

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

  const activeTr = transformers[activeIndex];
  const activeGateway = gateways.find((g) => g.id === activeTr?.linkedGatewayId);

  return (
    <div className="h-screen flex flex-col bg-surface-100">
      <header className="shrink-0 flex items-center justify-between gap-4 px-6 py-3 bg-white border-b border-surface-200 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => scrollToIndex(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="Previous transformer"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-surface-300 text-surface-600 hover:bg-surface-50 hover:border-surface-400 disabled:opacity-30 disabled:pointer-events-none transition"
          >
            &#8592;
          </button>

          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">
              Transformer {transformers.length > 0 ? activeIndex + 1 : 0} of {transformers.length}
            </p>
            <h1 className="text-lg font-semibold text-surface-900 truncate">
              {activeTr?.name ?? 'No transformer configured'}
            </h1>
          </div>

          <button
            onClick={() => scrollToIndex(activeIndex + 1)}
            disabled={activeIndex >= transformers.length - 1}
            aria-label="Next transformer"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-surface-300 text-surface-600 hover:bg-surface-50 hover:border-surface-400 disabled:opacity-30 disabled:pointer-events-none transition"
          >
            &#8594;
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {transformers.map((tr, i) => (
            <button
              key={tr.id}
              onClick={() => scrollToIndex(i)}
              aria-label={`Go to ${tr.name}`}
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
        {transformers.length === 0 && (
          <div className="w-full flex items-center justify-center">
            <div className="text-center max-w-sm">
              <p className="text-surface-700 font-medium mb-1">No transformers configured</p>
              <p className="text-sm text-surface-500">
                Add one from Settings &rarr; Connection Settings to start monitoring.
              </p>
            </div>
          </div>
        )}
        {transformers.map((tr) => (
          <div key={tr.id} className="w-full h-full shrink-0 snap-start overflow-y-auto">
            <TransformerPanel transformer={tr} />
          </div>
        ))}
      </div>

      <footer className="shrink-0 flex items-center justify-between px-6 py-2.5 bg-white border-t border-surface-200 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${activeGateway?.isConnected ? 'bg-status-good' : 'bg-surface-300'}`}
          />
          <span className="text-surface-600">
            {activeGateway?.isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {anyReading && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
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
