import type { DataLogDevice, DataLogTransformer } from './slice';

// The backend keeps every transformer any browser has ever pushed, so
// earlier setups (or another browser's settings) leave same-named entries
// behind - e.g. four "TR1 7.5 MVA" records, only one still getting data.
// Each transformer is listed ONCE: the one configured in this browser,
// merged with its same-named older records, whose devices appear in the
// device list as "old" (only if they have any stored history). Old records
// matching no configured transformer are grouped by name separately, and
// left out entirely when none of their devices has any stored readings.
export function groupTransformers(transformers: DataLogTransformer[], configuredIds: string[]): TransformerGroup[] {
  const nameKey = (name: string) => name.trim().toLowerCase();
  const configured = new Set(configuredIds);
  const backendById = new Map(transformers.map((tr) => [tr.id, tr]));
  const used = new Set<string>();
  const groups: TransformerGroup[] = [];

  for (const id of configuredIds) {
    const current = backendById.get(id);
    if (!current) continue; // not synced to the backend yet
    const olderSameName = transformers.filter(
      (tr) => !configured.has(tr.id) && !used.has(tr.id) && nameKey(tr.name) === nameKey(current.name)
    );
    [current, ...olderSameName].forEach((tr) => used.add(tr.id));
    groups.push({ key: current.id, name: current.name, isCurrent: true, currentId: current.id, members: [current, ...olderSameName] });
  }

  const leftoversByName = new Map<string, DataLogTransformer[]>();
  for (const tr of transformers) {
    if (used.has(tr.id)) continue;
    const key = nameKey(tr.name);
    leftoversByName.set(key, [...(leftoversByName.get(key) ?? []), tr]);
  }
  for (const [key, members] of leftoversByName) {
    const group: TransformerGroup = { key: `old:${key}`, name: members[0].name, isCurrent: false, currentId: null, members };
    // An old transformer with no stored readings has nothing to show.
    if (buildDeviceOptions(group).length > 0) groups.push(group);
  }
  return groups;
}

export interface TransformerGroup {
  key: string;
  name: string;
  isCurrent: boolean;
  // The record configured in this browser (null for an old-only group).
  currentId: string | null;
  members: DataLogTransformer[];
}

export type DeviceOption = DataLogDevice & { gatewayName: string; isOld: boolean };

// Devices of one transformer group: the configured record's devices first,
// then devices of its older same-named records - but only old ones that
// actually have stored readings (empty leftovers are just noise), newest
// first. In an old-only group every device counts as old.
export function buildDeviceOptions(group: TransformerGroup | undefined): DeviceOption[] {
  if (!group) return [];
  const options = group.members.flatMap((tr) =>
    tr.gateways.flatMap((gw) =>
      gw.devices.map((device) => ({ ...device, gatewayName: gw.name, isOld: tr.id !== group.currentId }))
    )
  );
  const current = options.filter((d) => !d.isOld);
  const old = options
    .filter((d) => d.isOld && d.lastReadingAt != null) // null or missing = nothing stored
    .sort((a, b) => (b.lastReadingAt ?? '').localeCompare(a.lastReadingAt ?? ''));
  return [...current, ...old];
}

export function formatShortDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
}

