import { useAppDispatch } from '../../../app/store/hooks';
import type { Transformer } from '../../../domain/entities/ConnectionSettings';
import type { RegisterOffsetMap } from '../../../domain/entities/TransformerRegisterMap';
import { updateTransformerReadConfig, updateTransformerRegisterOffset } from '../slice';

const FIELD_LABELS: Record<keyof RegisterOffsetMap, string> = {
  otiTemperature: 'OTI Temperature',
  otiTemperatureMax: 'OTI Max',
  wtiTemperature: 'WTI Temperature',
  wtiTemperatureMax: 'WTI Max',
  mog: 'MOG',
  tapPosition: 'Tap Position',
  tapCount: 'Tap Count',
  ptVoltage: 'PT Voltage',
  actualPtVoltage: 'Actual PT Voltage',
  operationMode: 'Operation Mode',
};

const FIELD_ORDER = Object.keys(FIELD_LABELS) as (keyof RegisterOffsetMap)[];

interface RegisterMapCardProps {
  transformer: Transformer;
}

export const RegisterMapCard = ({ transformer }: RegisterMapCardProps) => {
  const dispatch = useAppDispatch();
  const { startAddress, count, offsets } = transformer.registerConfig;

  return (
    <div className="bg-white rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">Register Map</p>
        <p className="text-xs text-surface-500 mt-0.5">
          FC03 read parameters for {transformer.name} — per-TR, since device layouts can differ.
        </p>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-4 border-b border-surface-100">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">Start Address</label>
          <input
            type="number"
            value={startAddress}
            onChange={(e) =>
              dispatch(
                updateTransformerReadConfig({
                  trId: transformer.id,
                  startAddress: Number(e.target.value) || 0,
                  count,
                })
              )
            }
            className="w-24 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-surface-500">Count</label>
          <input
            type="number"
            value={count}
            onChange={(e) =>
              dispatch(
                updateTransformerReadConfig({
                  trId: transformer.id,
                  startAddress,
                  count: Number(e.target.value) || 0,
                })
              )
            }
            className="w-20 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
      </div>

      <div className="px-4 py-2">
        {FIELD_ORDER.map((field) => (
          <div key={field} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm text-surface-600">{FIELD_LABELS[field]}</span>
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-surface-500">Offset</label>
              <input
                type="number"
                value={offsets[field]}
                onChange={(e) =>
                  dispatch(
                    updateTransformerRegisterOffset({
                      trId: transformer.id,
                      field,
                      offset: Number(e.target.value) || 0,
                    })
                  )
                }
                className="w-16 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
