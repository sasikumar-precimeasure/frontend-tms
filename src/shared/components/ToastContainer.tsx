import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/store/hooks';
import { dismissToast } from '../../features/toast/slice';
import type { Toast } from '../../features/toast/slice';

const AUTO_DISMISS_MS = 4000;

function ToastItem({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const timer = setTimeout(() => dispatch(dismissToast({ id: toast.id })), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dispatch]);

  const tone =
    toast.tone === 'error'
      ? 'bg-status-critical text-white'
      : 'bg-status-good text-white';

  return (
    <div
      role="status"
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-panel-enter ${tone}`}
    >
      <span>{toast.message}</span>
      <button
        onClick={() => dispatch(dismissToast({ id: toast.id }))}
        aria-label="Dismiss"
        className="ml-auto text-white/80 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}

// App-wide toast host: any write/save flow dispatches showToast(...) (see
// features/toast/slice.ts) and the toast appears here, bottom-right,
// regardless of which page is active. Mounted once at the app root.
export function ToastContainer() {
  const toasts = useAppSelector((state) => state.toast.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
