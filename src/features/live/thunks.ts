import { createAsyncThunk } from '@reduxjs/toolkit';
import type { Dependencies } from '../../app/dependencies';
import type { RootState } from '../../app/store';
import { AxiosError } from 'axios';
import type { GatewayServiceConfig, LiveDeviceReading } from '../../domain/entities/Modbus';
import { replaceConfigFromGateway, setConfigVersion } from '../connectionSettings/slice';
import { gatewayServiceUnreachable, liveSnapshotReceived } from './actions';
import { toGatewayConfig } from './gatewayConfig';

type ThunkConfig = { extra: Dependencies; state: RootState };

// Upload; if the gateway refuses because the user lacks write permission
// (403), fall back to its current settings rather than retrying forever.
async function putOrAdopt(extra: Dependencies, config: GatewayServiceConfig) {
  const repo = extra.modbus().modbusRepository;
  try {
    return await repo.putConfig(config);
  } catch (error) {
    if (error instanceof AxiosError && error.response?.status === 403) {
      return { status: 'forbidden' as const, config: await repo.getConfig() };
    }
    throw error;
  }
}

// Startup: whichever side has the newer settings wins - this browser's
// saved copy or the gateway service's (edited from another browser, or
// this browser's copy is from before the gateway service kept settings).
// `canUpload` = the user has write permission on Connection Settings; a
// read-only user's browser never uploads, it only takes the gateway's copy.
export const initGatewayConfigAsync = createAsyncThunk<'adopted' | 'uploaded' | 'unchanged', { canUpload: boolean }, ThunkConfig>(
  'live/initGatewayConfig',
  async ({ canUpload }, { extra, getState, dispatch }) => {
    const repo = extra.modbus().modbusRepository;
    const remote = await repo.getConfig();
    const local = getState().connectionSettings;

    if (remote.version > local.configVersion || (!canUpload && remote.version > 0 && remote.version !== local.configVersion)) {
      dispatch(replaceConfigFromGateway(remote));
      return 'adopted';
    }
    if (!canUpload) return 'unchanged';
    if (remote.version < local.configVersion || (local.configVersion === 0 && local.transformers.length > 0)) {
      const version = local.configVersion || Date.now();
      dispatch(setConfigVersion(version));
      const result = await putOrAdopt(extra, toGatewayConfig(getState().connectionSettings, version));
      if (result.status !== 'saved') {
        dispatch(replaceConfigFromGateway(result.config));
        return 'adopted';
      }
      return 'uploaded';
    }
    return 'unchanged';
  }
);

// A local Settings edit: stamp it with a new version and upload it. If the
// gateway already has newer settings (edited in another tab meanwhile),
// switch to those instead.
export const uploadGatewayConfigAsync = createAsyncThunk<'saved' | 'adopted', void, ThunkConfig>(
  'live/uploadGatewayConfig',
  async (_, { extra, getState, dispatch }) => {
    const version = Math.max(Date.now(), getState().connectionSettings.configVersion + 1);
    dispatch(setConfigVersion(version));
    const result = await putOrAdopt(extra, toGatewayConfig(getState().connectionSettings, version));
    if (result.status !== 'saved') {
      dispatch(replaceConfigFromGateway(result.config));
      return 'adopted';
    }
    return 'saved';
  }
);

export const adoptGatewayConfigAsync = createAsyncThunk<void, void, ThunkConfig>(
  'live/adoptGatewayConfig',
  async (_, { extra, dispatch }) => {
    dispatch(replaceConfigFromGateway(await extra.modbus().modbusRepository.getConfig()));
  }
);

// Latest values + connection states for display. Returns the gateway's
// config version so the caller can notice settings changed elsewhere.
export const pollLiveAsync = createAsyncThunk<{ configVersion: number } | null, void, ThunkConfig>(
  'live/poll',
  async (_, { extra, getState, dispatch }) => {
    try {
      const snapshot = await extra.modbus().modbusRepository.getLive();
      const devicesByReadingKey: Record<string, LiveDeviceReading> = {};
      for (const tr of getState().connectionSettings.transformers) {
        for (const gw of tr.gateways) {
          for (const device of gw.subDevices) {
            const reading = snapshot.devices[device.id];
            if (reading) devicesByReadingKey[`${tr.id}:${device.id}`] = reading;
          }
        }
      }
      dispatch(liveSnapshotReceived({ snapshot, devicesByReadingKey }));
      return { configVersion: snapshot.configVersion };
    } catch {
      dispatch(gatewayServiceUnreachable('Gateway service is not running or not reachable (it reads the devices).'));
      return null;
    }
  }
);
