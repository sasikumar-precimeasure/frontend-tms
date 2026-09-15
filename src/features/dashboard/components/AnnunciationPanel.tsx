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
// alarm/trip tiles. Red "<label> ON" while active, green "<label> OFF"
// otherwise. Clicking an active alarm tile writes to the device's real ack
// register (FC06), mirroring the legacy app's register-driven acknowledge
// rather than a purely local UI flag - the device is the source of truth for
// ack state, same as every other reading on this dashboard.
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

  // FC06 overwrites the whole register, so acknowledging one tile's bit
  // must read-modify-write the current ack word (from the last poll) rather
  // than writing a single-bit value, or every other tile's ack bit in that
  // same word would be clobbered.
  const handleAcknowledge = (tileIndex: number, word: 1 | 2) => {
    const offset = word === 1 ? offsets.annAckWord1 : offsets.annAckWord2;
    const currentWord = (word === 1 ? ackWords[0] : ackWords[1]) ?? 0;
    const bit = word === 1 ? tileIndex : tileIndex - 10;
    const key = `${trId}:ann-ack:${word}`;
    dispatch(
      writeRegisterAsync({
        key,
        clientId,
        slaveId,
        address: startAddress + offset,
        value: currentWord | (1 << bit),
      })
    );
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

  return (
    <div className="space-y-4">
      {/* Hooter Sat - a standalone status row, not a grid tile, matching how
          Form1.txt renders it as its own control separate from the
          annunciation grid. */}
      <div
        className={`flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${
          hooterOn === null ? 'bg-surface-100 text-surface-400' : hooterOn ? 'bg-status-critical text-white' : 'bg-status-good text-white'
        } ${hooterOn ? 'animate-pulse' : ''}`}
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
            const isAcked = unavailable ? null : (acknowledged?.[i] ?? null);
            const writeKey = `${trId}:ann-ack:${tile.word}`;
            const isWriting = writesByKey[writeKey]?.isWriting ?? false;
            const clickable = isActive === true && !isAcked;

            const tone =
              isActive === null
                ? 'bg-surface-100 text-surface-400'
                : isActive
                  ? 'bg-status-critical text-white'
                  : 'bg-status-good text-white';
            const pulse = isActive === true && !isAcked ? 'animate-pulse' : '';

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
