import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { ANNUNCIATION_TILES } from '../../../domain/entities/TransformerRegisterMap';
import type { RegisterOffsetMap } from '../../../domain/entities/TransformerRegisterMap';
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

// Annunciation screen mirroring the legacy VB app: a Hooter Sat row (its own
// direct-value register, not part of the 12-bit alarm words - kept visually
// separate from the alarm/trip grid, same as Form1.txt renders it as its own
// control rather than a grid tile) with an adjacent Mute control (shown only
// while Mute Sat is active, mirrors Btn_Mute), followed by the 12 fixed
// alarm/trip tiles.
//
// Two separate words drive each tile, ported directly from Form1.txt's main
// poll handler, Blink_Tick/UpdateAlarm, and lblAnnN_Click:
// - ALARM word: sets the base red "ON" / green "OFF" color+text. A tile's
//   clickable ("Enabled") state is a genuine persistent flag in the legacy
//   app - set True the moment the alarm bit goes active, left untouched
//   (not reset) when the alarm clears, and set False only by clicking -
//   tracked here as real component state (`enabledByTile`) for the same
//   reason, rather than derived fresh from each poll.
// - ACK word: UpdateAlarm's blink toggle (Red<->Silver) fires purely off
//   this bit (`alarmValue >= 1`), with NO dependency on the alarm word - a
//   tile can blink while showing green if its fault cleared but it hasn't
//   been acknowledged yet. Clicking is gated on the ack bit being 1
//   (lblAnnN_Click's `If AnnAck(n) >= 1`); it clears that bit and writes
//   the updated ack word back via FC06 - the alarm word itself is never
//   touched by a click.
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

  // FC06 overwrites the whole register, so acknowledging one tile's bit
  // must read-modify-write the current ack word (from the last poll) rather
  // than writing a single-bit value, or every other tile's ack bit in that
  // same word would be clobbered. Mirrors lblAnnN_Click: only proceeds
  // while the ack bit is 1, then clears it and disables the tile locally.
  const handleAcknowledge = (tileIndex: number, word: 1 | 2) => {
    const offset = word === 1 ? offsets.annAckWord1 : offsets.annAckWord2;
    const currentWord = (word === 1 ? ackWords[0] : ackWords[1]) ?? 0;
    const bit = word === 1 ? tileIndex : tileIndex - 10;
    const newWord = currentWord & ~(1 << bit);
    const key = `${trId}:ann-ack:${word}`;
    const address = startAddress + offset;
    console.log(
      `[Annunciation] Acknowledge "${ANNUNCIATION_TILES[tileIndex].label}" (tile ${tileIndex}, word ${word}, bit ${bit}): ` +
        `address=${address} currentWord=${currentWord.toString(2).padStart(10, '0')} -> newWord=${newWord.toString(2).padStart(10, '0')}`
    );
    dispatch(
      writeRegisterAsync({
        key,
        clientId,
        slaveId,
        address,
        value: newWord,
      })
    )
      .unwrap()
      .then((result) => {
        console.log(`[Annunciation] Acknowledge write for "${ANNUNCIATION_TILES[tileIndex].label}" resolved:`, result);
      })
      .catch((error) => {
        console.log(`[Annunciation] Acknowledge write for "${ANNUNCIATION_TILES[tileIndex].label}" FAILED:`, error);
      });
    setEnabledByTile((prev) => {
      const next = prev.slice();
      next[tileIndex] = false;
      return next;
    });
  };

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
            // Clickable is the persistent enabledByTile flag (mirrors the
            // legacy label's Enabled property), not derived from the
            // current poll alone. Blink follows the ack bit by itself, per
            // UpdateAlarm - independent of the alarm/color state, so a
            // green tile can still blink if unacknowledged.
            const clickable = !unavailable && enabledByTile[i];
            const blinking = isUnacked === true;

            const tone =
              isActive === null
                ? 'bg-surface-100 text-surface-400'
                : isActive
                  ? 'bg-status-critical text-white'
                  : 'bg-status-good text-white';
            const pulse = blinking ? 'animate-pulse' : '';

            return (
              <button
                key={tile.label}
                type="button"
                disabled={!clickable || isWriting}
                onClick={() => handleAcknowledge(i, tile.word)}
                title={clickable ? 'Click to acknowledge' : undefined}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-5 text-center text-xs font-semibold transition-opacity ${tone} ${pulse} ${clickable ? 'cursor-pointer hover:opacity-90' : 'cursor-default'} disabled:opacity-70`}
              >
                <span>{tile.label}</span>
                <span className="text-[11px] font-bold uppercase tracking-wide opacity-90">
                  {isActive === null ? 'N/A' : isActive ? 'ON' : 'OFF'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
