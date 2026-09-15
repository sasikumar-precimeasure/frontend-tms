import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { SettingsSidebar } from '../components/SettingsSidebar';
import type { SettingsSection } from '../components/SettingsSidebar';
import { TransformerConnectionCard } from '../components/TransformerConnectionCard';
import { RegisterMapCard } from '../components/RegisterMapCard';
import { selectTr, addTransformer, removeTransformer, renameTransformer } from '../slice';

const SettingsPage = () => {
  const dispatch = useAppDispatch();
  const { selectedTrId, transformers } = useAppSelector((state) => state.connectionSettings);
  const [section, setSection] = useState<SettingsSection>('Connection Settings');

  const selectedTr = transformers.find((tr) => tr.id === selectedTrId) ?? transformers[0];

  return (
    <div className="min-h-screen bg-surface-100">
      <header className="px-6 py-5 bg-surface-0 border-b border-surface-200">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Settings</p>
        <h1 className="text-xl font-semibold text-surface-900">{selectedTr?.name ?? 'No transformer selected'}</h1>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 flex gap-6 items-start">
        <aside className="w-64 shrink-0 space-y-4">
          <div className="bg-surface-0 rounded-lg border border-surface-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Transformers</p>
              <button
                onClick={() => dispatch(addTransformer())}
                className="text-xs font-semibold text-primary hover:text-primary-700"
              >
                + Add
              </button>
            </div>

            <select
              value={selectedTrId}
              onChange={(e) => dispatch(selectTr(e.target.value))}
              className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md"
            >
              {transformers.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>

            {selectedTr && (
              <>
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Name</label>
                  <input
                    value={selectedTr.name}
                    onChange={(e) => dispatch(renameTransformer({ trId: selectedTr.id, name: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md"
                  />
                </div>

                <button
                  onClick={() => dispatch(removeTransformer({ trId: selectedTr.id }))}
                  className="text-xs text-surface-400 hover:text-status-critical font-medium"
                >
                  Remove this transformer
                </button>
              </>
            )}
          </div>

          <div className="bg-surface-0 rounded-lg border border-surface-200 p-2">
            <SettingsSidebar active={section} onSelect={setSection} />
          </div>
        </aside>

        <main className="flex-1 min-w-0 space-y-4">
          <h2 className="text-sm font-semibold text-surface-700">{section}</h2>

          {selectedTr ? (
            <>
              <TransformerConnectionCard transformer={selectedTr} />
              {selectedTr.subDevices.map((device) => (
                <RegisterMapCard key={device.id} trId={selectedTr.id} device={device} />
              ))}
            </>
          ) : (
            <div className="bg-surface-0 rounded-lg border border-dashed border-surface-300 p-8 text-center">
              <p className="text-sm text-surface-500">No transformers configured yet.</p>
              <button
                onClick={() => dispatch(addTransformer())}
                className="mt-2 text-sm font-semibold text-primary hover:text-primary-700"
              >
                + Add your first transformer
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
