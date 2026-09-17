import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { ANNUNCIATION_TILES } from '../../../domain/entities/TransformerRegisterMap';
import type { AnnunciationTile, RegisterOffsetMap } from '../../../domain/entities/TransformerRegisterMap';
import { writeRegisterAsync } from '../slice';

interface AnnunciationPanelProps {
  trId: string;
  clientId: number;
  slaveId: number;
  startAddress: number;
  offsets: RegisterOffsetMap;
  active: (boolean | null)[] | null;
  acknowledged: (boolean | null)[] | null;
  ackWords: [number | null, number | null];
  hooterActive: boolean | null;
  muteVisible: boolean | null;
  unavailable?: boolean;
}

interface TileButtonProps {
  tileIndex: number;
  tile: AnnunciationTile;
  isActive: boolean | null;
  isUnacked: boolean | null;
  clickable: boolean;
  isWriting: boolean;
  onAcknowledge: (tileIndex: number) => void;
}

// Memoized so a poll tick (every 1s, regardless of whether any value
// actually changed) or an ack write on ONE tile doesn't re-render every
// other tile - React skips this component entirely unless its own props
// (this tile's active/unacked/clickable/isWriting) actually changed. This
// was the cause of the whole grid visibly flickering on every update.
// `onAcknowledge` takes the tileIndex as an argument (rather than each
// caller passing a pre-bound closure) specifically so its identity stays
// stable across renders - a fresh arrow function per tile would defeat the
// memoization by always looking like a "changed" prop.
const TileButton = memo(function TileButton({
  tileIndex,
  tile,
  isActive,
  isUnacked,
  clickable,
  isWriting,
  onAcknowledge,
}: TileButtonProps) {
  const tone =
    isActive === null
      ? 'bg-surface-100 text-surface-400'
      : isActive
        ? 'bg-status-critical text-white'
        : 'bg-status-good text-white';
  // Blink requires BOTH the alarm bit and the ack bit to be 1 (active and
  // unacknowledged) - see the module doc comment below for why.
  const pulse = isActive === true && isUnacked === true ? 'animate-pulse' : '';

  return (
    <button
      type="button"
      disabled={!clickable || isWriting}
      onClick={() => onAcknowledge(tileIndex)}
      title={clickable ? 'Click to acknowledge' : undefined}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-5 text-center text-xs font-semibold transition-opacity ${tone} ${pulse} ${clickable ? 'cursor-pointer hover:opacity-90' : 'cursor-default'} disabled:opacity-70`}
    >
      <span>{tile.label}</span>
      <span className="text-[11px] font-bold uppercase tracking-wide opacity-90">
        {isActive === null ? 'N/A' : isActive ? 'ON' : 'OFF'}
      </span>
    </button>
  );
});

// Annunciation screen mirroring the legacy VB app: a Hooter Sat row (its own
// direct-value register, not part of the 12-bit alarm words - kept visually
// separate from the alarm/trip grid, same as Form1.txt renders it as its own
// control rather than a grid tile) with an adjacent Mute control (shown only
// while Mute Sat is active, mirrors Btn_Mute), followed by the 12 fixed
// alarm/trip tiles.
//
// Two separate words drive each tile (confirmed against Form1.txt's main
// poll handler, Blink_Tick/UpdateAlarm, and lblAnnN_Click): the ALARM word
// sets the base red "ON" / green "OFF" color+text and clickability - the
// legacy label control is only re-Enabled when the alarm bit goes active,
// and its Enabled flag is otherwise stateful (persists across polls,
// cleared only by clicking), which a stateless dashboard can't replicate;
// simplified here to "clickable only while the alarm bit is 1." The ACK
// word's bit additionally gates blinking: a tile blinks only while BOTH the
// alarm bit and the ack bit are 1 (active and unacknowledged) - a green
// (alarm=0) tile never blinks, and acknowledging an active tile silences
// the blink immediately without needing the fault to clear. Clicking an
// active (alarm bit = 1) tile clears its ack bit and writes the updated ack
// word back via FC06 - the alarm word itself is never touched by a click.
export function AnnunciationPanel({
  trId,
  clientId,
  slaveId,
  startAddress,
  offsets,
  active,
  acknowledged,
  ackWords,
  hooterActive,
  muteVisible,
  unavailable,
}: AnnunciationPanelProps) {
  const dispatch = useAppDispatch();
  const writesByKey = useAppSelector((state) => state.dashboard.writesByKey);

  // Mirrors the legacy label's persistent Enabled flag: True the moment the
  // alarm bit transitions 0->1, otherwise left as-is (including when the
  // alarm bit later drops back to 0), False only once clicked. Detected via
  // a previous-value comparison during render - the sanctioned pattern this
  // codebase already uses for reset-on-change state (see useValueFlash.ts) -
  // rather than an effect, since this isn't synchronizing with an external
  // system.
  // Initialize from whatever's already active on first render (e.g. the
  // drawer was opened while a fault was already alarming) - not just future
  // transitions, since there's no "before mount" state to compare against.
  const [enabledByTile, setEnabledByTile] = useState<boolean[]>(() =>
    ANNUNCIATION_TILES.map((_, i) => active?.[i] ?? false)
  );
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    const next = enabledByTile.slice();
    let changed = false;
    ANNUNCIATION_TILES.forEach((_, i) => {
      const wasActive = prevActive?.[i] ?? false;
      const isActiveNow = active?.[i] ?? false;
      if (!wasActive && isActiveNow && !next[i]) {
        next[i] = true;
        changed = true;
      }
    });
    if (changed) setEnabledByTile(next);
  }

  // Read via a ref (updated every render below, not a dependency of the
  // callback itself) so handleAcknowledge's identity stays stable across
  // polls - ackWords changes every ~1s, and if the callback depended on it
  // directly, every TileButton would lose its memoization on every poll
  // tick even though almost nothing actually changed.
  const ackWordsRef = useRef(ackWords);
  useEffect(() => {
    ackWordsRef.current = ackWords;
  }, [ackWords]);

  // FC06 overwrites the whole register, so acknowledging one tile's bit
  // must read-modify-write the current ack word (from the last poll) rather
  // than writing a single-bit value, or every other tile's ack bit in that
  // same word would be clobbered. The button itself is only enabled while
  // the tile's alarm bit is 1 (see `clickable` below); clearing a bit
  // that's already 0 is a harmless no-op.
  const handleAcknowledge = useCallback(
    (tileIndex: number) => {
      const tile = ANNUNCIATION_TILES[tileIndex];
      const word = tile.word;
      const offset = word === 1 ? offsets.annAckWord1 : offsets.annAckWord2;
      const currentWord = (word === 1 ? ackWordsRef.current[0] : ackWordsRef.current[1]) ?? 0;
      const bit = tile.bit;
      const newWord = currentWord & ~(1 << bit);
      const key = `${trId}:ann-ack:${word}`;
      dispatch(
        writeRegisterAsync({
          key,
          clientId,
          slaveId,
          address: startAddress + offset,
          value: newWord,
        })
      );
      setEnabledByTile((prev) => {
        const next = prev.slice();
        next[tileIndex] = false;
        return next;
      });
    },
    [offsets, trId, clientId, slaveId, startAddress, dispatch]
  );

  // Mirrors Btn_Mute_Click: WriteSingleRegister(slaveId, muteWriteAddress, 0)
  // silences the hooter relay on the device.
  const muteKey = `${trId}:ann-mute`;
  const isMuting = writesByKey[muteKey]?.isWriting ?? false;
  const handleMute = () => {
    dispatch(
      writeRegisterAsync({
        key: muteKey,
        clientId,
        slaveId,
        address: startAddress + offsets.annMuteWriteRegister,
        value: 0,
      })
    );
  };

  const hooterOn = unavailable ? null : (hooterActive ?? null);
  const showMute = unavailable ? false : (muteVisible ?? false);
  // Hooter blinks only while mute is available (i.e. there's something to
  // silence) - once muted/no active fault, it stays a steady color.
  const hooterBlinking = hooterOn === true && showMute;

  return (
    <div className="space-y-4">
      {/* Hooter Sat - a standalone status row, not a grid tile, matching how
          Form1.txt renders it as its own control separate from the
          annunciation grid. */}
      <div
        className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${
          hooterOn === null ? 'bg-surface-100 text-surface-400' : hooterOn ? 'bg-status-critical text-white' : 'bg-status-good text-white'
        } ${hooterBlinking ? 'animate-pulse' : ''}`}
      >
        <span className="text-sm font-semibold">Hooter</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide opacity-90">
            {hooterOn === null ? 'N/A' : hooterOn ? 'ON' : 'OFF'}
          </span>
          {showMute && (
            <button
              type="button"
              onClick={handleMute}
              disabled={isMuting}
              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-white/15 hover:bg-white/25 transition disabled:opacity-50"
            >
              {isMuting ? 'Muting…' : 'Mute'}
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 mb-2">Alarms &amp; Trips</p>
        <div className="grid grid-cols-3 gap-2">
          {ANNUNCIATION_TILES.map((tile, i) => {
            const isActive = unavailable ? null : (active?.[i] ?? null);
            const isUnacked = unavailable ? null : (acknowledged?.[i] ?? null);
            const writeKey = `${trId}:ann-ack:${tile.word}`;
            const isWriting = writesByKey[writeKey]?.isWriting ?? false;
            const clickable = !unavailable && enabledByTile[i];

            return (
              <TileButton
                key={tile.label}
                tileIndex={i}
                tile={tile}
                isActive={isActive}
                isUnacked={isUnacked}
                clickable={clickable}
                isWriting={isWriting}
                onAcknowledge={handleAcknowledge}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
