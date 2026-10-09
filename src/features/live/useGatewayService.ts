import { useEffect } from 'react';
import { useAppDispatch, useAppStore } from '../../app/store/hooks';
import { configFingerprint } from './gatewayConfig';
import { hasWritePermission } from '../../shared/hooks/usePermissions';
import { adoptGatewayConfigAsync, initGatewayConfigAsync, pollLiveAsync, uploadGatewayConfigAsync } from './thunks';

const TICK_MS = 1000;

// Keeps this browser in step with the gateway service, which does the
// actual polling of the hardware: syncs Settings both ways and refreshes the
// live values once a second. Mounted once for the whole app (TmsAppLayout).
// If Chrome throttles this tab while it's hidden, only the screen updates
// less often - polling and the backend push carry on in the gateway service.
export function useGatewayService(): void {
  const dispatch = useAppDispatch();
  const store = useAppStore();

  useEffect(() => {
    let initialized = false;
    let syncedFingerprint: string | null = null;
    let busy = false;

    const fingerprint = () => configFingerprint(store.getState().connectionSettings);
    // Only users with write permission on Connection Settings send settings
    // to the gateway service; everyone else just follows its copy.
    const canUpload = () => hasWritePermission(store.getState().auth.permissions, 'Connection Settings');

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        if (!initialized) {
          // Wait for the user's permissions before deciding who wins.
          if (store.getState().auth.permissionsLoaded) {
            await dispatch(initGatewayConfigAsync({ canUpload: canUpload() })).unwrap();
            initialized = true;
            syncedFingerprint = fingerprint();
          }
        } else if (fingerprint() !== syncedFingerprint) {
          if (canUpload()) await dispatch(uploadGatewayConfigAsync()).unwrap();
          else await dispatch(adoptGatewayConfigAsync()).unwrap();
          syncedFingerprint = fingerprint();
        }

        const live = await dispatch(pollLiveAsync()).unwrap();
        if (live && live.configVersion > store.getState().connectionSettings.configVersion && fingerprint() === syncedFingerprint) {
          // Settings were changed from another tab or browser.
          await dispatch(adoptGatewayConfigAsync()).unwrap();
          syncedFingerprint = fingerprint();
        }
      } catch {
        // Gateway service unreachable - pollLiveAsync already reported it;
        // an unsent settings change is retried on the next tick.
        if (!initialized) await dispatch(pollLiveAsync());
      } finally {
        busy = false;
      }
    };

    void tick();
    const intervalId = setInterval(() => void tick(), TICK_MS);
    return () => clearInterval(intervalId);
  }, [dispatch, store]);
}
