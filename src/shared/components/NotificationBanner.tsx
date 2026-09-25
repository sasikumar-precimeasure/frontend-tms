import { useAppDispatch, useAppSelector } from '../../app/store/hooks';
import { dismissNotification, openDrawerFor } from '../../features/notifications/slice';
import type { AppNotification } from '../../features/notifications/slice';
import MainRouter from '../../app/router/MainRouter';

const BellIcon = (
  <svg viewBox="0 0 20 20" width={16} height={16} fill="none" aria-hidden>
    <path
      d="M10 2.5c-2.2 0-4 1.8-4 4v2.3c0 .5-.2 1-.6 1.4L4 11.7c-.5.5-.1 1.3.6 1.3h10.8c.7 0 1.1-.8.6-1.3l-1.4-1.5c-.4-.4-.6-.9-.6-1.4V6.5c0-2.2-1.8-4-4-4z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path d="M8.2 15.5a1.8 1.8 0 003.6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

function NotificationRow({ notification }: { notification: AppNotification }) {
  const dispatch = useAppDispatch();

  const handleClick = () => {
    dispatch(openDrawerFor({ trId: notification.trId, deviceId: notification.deviceId }));
    dispatch(dismissNotification({ id: notification.id }));
    // NotificationBanner is mounted at the App root, outside <RouterProvider>
    // (it must render over every route, not just ones nested under a
    // layout), so useNavigate() has no router context here - MainRouter's
    // own navigate() is the documented way to navigate imperatively from
    // outside the routed component tree with a data router.
    MainRouter.navigate('/dashboard');
  };

  return (
    <div
      role="alert"
      className="flex items-center gap-3 px-4 py-2.5 bg-primary text-white text-sm font-medium shadow-md animate-panel-enter"
    >
      <span className="shrink-0">{BellIcon}</span>
      <button onClick={handleClick} className="flex-1 min-w-0 text-left truncate hover:underline">
        {notification.message} — click to view
      </button>
      <button
        onClick={() => dispatch(dismissNotification({ id: notification.id }))}
        aria-label="Dismiss"
        className="shrink-0 text-white/80 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}

// App-wide banner docked to the very top of the screen, above everything
// else (including TmsAppLayout's own header) - fires on an annunciation
// acknowledge from anywhere in the app, since the person acting on an alarm
// may not be looking at the Dashboard when they do it. Clicking navigates to
// /dashboard and hands off which device's drawer to auto-open via
// notifications/slice's pendingDrawerTarget (read by DashboardPage/
// DevicePanel). Distinct from the bottom-right toast (ToastContainer),
// which is for routine save confirmations, not something to act on.
export function NotificationBanner() {
  const notifications = useAppSelector((state) => state.notifications.notifications);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[200] flex flex-col">
      {notifications.map((notification) => (
        <NotificationRow key={notification.id} notification={notification} />
      ))}
    </div>
  );
}
