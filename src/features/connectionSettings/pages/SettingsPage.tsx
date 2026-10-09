import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import { SettingsSidebar } from '../components/SettingsSidebar';
import type { SettingsSection } from '../components/SettingsSidebar';
import { useFirstAllowedSettingsSection } from '../settingsSectionPermissions';
import { TransformerConnectionCard } from '../components/TransformerConnectionCard';
import { DataSyncSettingsCard } from '../components/DataSyncSettingsCard';
import { RegisterMapCard } from '../components/RegisterMapCard';
import { AvrSettingsCard } from '../components/AvrSettingsCard';
import { MailConfigurationCard } from '../components/MailConfigurationCard';
import { MonthlyReportCard } from '../components/MonthlyReportCard';
import { useCanWrite, useHasMenuPermission } from '../../../shared/hooks/usePermissions';
import { WriteGate } from '../../../shared/components/WriteGate';
import { selectTr, addTransformer, removeTransformer, renameTransformer, addGateway } from '../slice';

const SettingsPage = () => {
  const dispatch = useAppDispatch();
  // Monthly Report has its own permission (Super Admin only by default).
  const canSeeMonthlyReport = useHasMenuPermission('Monthly Report');
  // Adding/renaming/removing transformers is a Connection Settings change.
  const canEditTransformers = useCanWrite('Connection Settings');
  const { selectedTrId, transformers } = useAppSelector((state) => state.connectionSettings);
  const firstAllowedSection = useFirstAllowedSettingsSection();
  const [section, setSection] = useState<SettingsSection | null>(firstAllowedSection);

  const selectedTr = transformers.find((tr) => tr.id === selectedTrId) ?? transformers[0];

  if (section === null) {
    return (
      <div className="min-h-screen bg-surface-100">
        <header className="px-6 py-5 bg-surface-0 border-b border-surface-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Settings</p>
          <h1 className="text-xl font-semibold text-surface-900">No access</h1>
        </header>
        <div className="max-w-2xl mx-auto px-6 py-6">
          <p className="text-sm text-surface-500">You do not have permission to view any Settings section.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-100">
      <header className="px-6 py-5 bg-surface-0 border-b border-surface-200">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Settings</p>
        <h1 className="text-xl font-semibold text-surface-900">
          {section === 'Mail Configuration' ? section : (selectedTr?.name ?? 'No transformer selected')}
        </h1>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 flex gap-6 items-start">
        <aside className="w-64 shrink-0 space-y-4">
          <div className="bg-surface-0 rounded-lg border border-surface-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Transformers</p>
              {canEditTransformers && (
                <button
                  onClick={() => dispatch(addTransformer())}
                  className="text-xs font-semibold text-primary hover:text-primary-700"
                >
                  + Add
                </button>
              )}
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
                    disabled={!canEditTransformers}
                    className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md disabled:bg-surface-100 disabled:text-surface-500"
                  />
                </div>

                {canEditTransformers && (
                  <button
                    onClick={() => dispatch(removeTransformer({ trId: selectedTr.id }))}
                    className="text-xs text-surface-400 hover:text-status-critical font-medium"
                  >
                    Remove this transformer
                  </button>
                )}
              </>
            )}
          </div>

          <div className="bg-surface-0 rounded-lg border border-surface-200 p-2">
            <SettingsSidebar active={section} onSelect={setSection} />
          </div>
        </aside>

        <main className="flex-1 min-w-0 space-y-4">
          <h2 className="text-sm font-semibold text-surface-700">{section}</h2>

          {section === 'Mail Configuration' ? (
            <div className="space-y-4">
              <WriteGate menu="Mail Configuration">
                <MailConfigurationCard />
              </WriteGate>
              {canSeeMonthlyReport && <MonthlyReportCard />}
            </div>
          ) : selectedTr ? (
            section === 'AVR Settings' ? (
              (() => {
                const irtccDevices = selectedTr.gateways.flatMap((gateway) =>
                  gateway.subDevices
                    .filter((device) => device.deviceType === 'irtcc')
                    .map((device) => ({ device, gateway }))
                );
                return irtccDevices.length > 0 ? (
                  <WriteGate menu="AVR Settings">
                    {irtccDevices.map(({ device, gateway }) => (
                      <AvrSettingsCard
                        key={device.id}
                        trId={selectedTr.id}
                        clientId={gateway.clientId}
                        isConnected={gateway.isConnected}
                        device={device}
                      />
                    ))}
                  </WriteGate>
                ) : (
                  <div className="bg-surface-0 rounded-lg border border-dashed border-surface-300 p-8 text-center">
                    <p className="text-sm text-surface-500">
                      No IRTCC device configured for {selectedTr.name} yet - add one under Connection Settings.
                    </p>
                  </div>
                );
              })()
            ) : (
              <WriteGate menu="Connection Settings">
                <DataSyncSettingsCard />
                {selectedTr.gateways.map((gateway) => (
                  <TransformerConnectionCard key={gateway.id} trId={selectedTr.id} gateway={gateway} />
                ))}
                <button
                  onClick={() => dispatch(addGateway({ trId: selectedTr.id }))}
                  className="text-xs font-semibold text-primary hover:text-primary-700"
                >
                  + Add Gateway
                </button>
                {selectedTr.gateways.flatMap((gateway) =>
                  gateway.subDevices.map((device) => (
                    <RegisterMapCard key={device.id} trId={selectedTr.id} gatewayId={gateway.id} device={device} />
                  ))
                )}
              </WriteGate>
            )
          ) : (
            <div className="bg-surface-0 rounded-lg border border-dashed border-surface-300 p-8 text-center">
              <p className="text-sm text-surface-500">No transformers configured yet.</p>
              {canEditTransformers && (
                <button
                  onClick={() => dispatch(addTransformer())}
                  className="mt-2 text-sm font-semibold text-primary hover:text-primary-700"
                >
                  + Add your first transformer
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
