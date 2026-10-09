import type { Transformer } from '../../domain/entities/ConnectionSettings';
import type { GatewayServiceConfig } from '../../domain/entities/Modbus';

interface ConfigSource {
  transformers: Transformer[];
  readingsPushIntervalSeconds: number;
}

// The website's Settings, in the shape the gateway service polls with.
// Live fields (status / isConnected / errorMessage) are left out - they come
// back FROM the gateway; everything else (register maps, mail thresholds,
// ...) is passed through whole so it round-trips unchanged.
export function toGatewayConfig(source: ConfigSource, version: number): GatewayServiceConfig {
  return {
    version,
    readingsPushIntervalSeconds: source.readingsPushIntervalSeconds,
    transformers: source.transformers.map((tr) => ({
      id: tr.id,
      name: tr.name,
      gateways: tr.gateways.map((gw) => ({
        id: gw.id,
        name: gw.name,
        clientId: gw.clientId,
        ipAddress: gw.ipAddress,
        port: gw.port,
        // Connect / Disconnect in Settings: the gateway service polls only
        // gateways with autoConnect on.
        autoConnect: gw.autoReconnect !== false,
        busGroup: gw.busGroup,
        // Mail thresholds belong to Mail Configuration (saved to the backend
        // separately), not to what the gateway service polls - left out so
        // editing them doesn't need Connection Settings permission.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        subDevices: gw.subDevices.map(({ mailThresholds, ...device }) => ({ ...device })),
      })),
    })),
  };
}

// Identifies the settings content regardless of version - used to notice
// local edits that still need uploading.
export function configFingerprint(source: ConfigSource): string {
  return JSON.stringify(toGatewayConfig(source, 0));
}
