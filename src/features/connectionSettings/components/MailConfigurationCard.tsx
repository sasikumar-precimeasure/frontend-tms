import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { MailRecipient, MailSenderSettings, MailThresholds } from '../../../domain/entities/MailSettings';
import {
  fetchMailSettingsAsync,
  saveSenderSettingsAsync,
  saveRecipientAsync,
  deleteRecipientAsync,
  saveMailThresholdsAsync,
  toggleRecipientEnabledLocal,
  toggleRecipientDeviceLocal,
} from '../../mailSettings/slice';
import { updateSubDeviceMailThresholds } from '../slice';
import { showToast } from '../../toast/slice';

// IsValidEmailLegacy in Form1.txt uses System.Net.Mail.MailAddress's own
// parser - a plain "has an @ and something on both sides" check is a
// reasonable client-side equivalent here without pulling in a library.
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

interface DeviceOption {
  id: string;
  label: string;
}

// From: sender identity + SMTP settings (mirrors senderEmail_Settings) - one
// app-wide sender, matching the legacy single-row table. Persisted to
// tms-backend, which is what the scheduled mail job actually reads.
function SenderSettingsSection() {
  const dispatch = useAppDispatch();
  const sender = useAppSelector((state) => state.mailSettings.sender);
  const [draft, setDraft] = useState<MailSenderSettings>(sender);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset the draft whenever the fetched sender settings change (e.g. once
  // the initial load completes) - detected via a previous-value comparison
  // during render (the pattern this codebase uses for reset-on-change state,
  // see AnnunciationPanel.tsx) rather than an effect, since this isn't
  // synchronizing with an external system.
  const [prevSender, setPrevSender] = useState(sender);
  if (prevSender !== sender) {
    setPrevSender(sender);
    setDraft(sender);
  }

  const handleSave = async () => {
    if (draft.senderName.trim() === '') {
      setError('Please enter sender name');
      return;
    }
    if (!isValidEmail(draft.senderEmail)) {
      setError('Please enter a valid sender email');
      return;
    }
    if (draft.smtpHost.trim() === '') {
      setError('Please enter SMTP host');
      return;
    }
    if (!Number.isFinite(draft.smtpPort) || draft.smtpPort <= 0) {
      setError('Please enter a valid SMTP port');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // ManageMailSettingsUseCase.saveSenderSettings already writes its own
      // MAIL_CONFIG_CHANGE audit row server-side - don't double it here.
      await dispatch(saveSenderSettingsAsync(draft)).unwrap();
      dispatch(showToast('Sender settings updated successfully'));
    } catch {
      setError('Failed to save sender settings - is the backend reachable?');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
      <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
        <p className="text-sm font-semibold text-surface-800">From — Sender Settings</p>
        <p className="text-xs text-surface-500 mt-0.5">The account alert emails are sent from.</p>
      </div>
      <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Sender Name</label>
          <input
            value={draft.senderName}
            onChange={(e) => setDraft({ ...draft, senderName: e.target.value })}
            className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">Sender Email</label>
          <input
            type="email"
            value={draft.senderEmail}
            onChange={(e) => setDraft({ ...draft, senderEmail: e.target.value })}
            placeholder="alerts@example.com"
            className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">SMTP Host</label>
          <input
            value={draft.smtpHost}
            onChange={(e) => setDraft({ ...draft, smtpHost: e.target.value })}
            placeholder="smtp.gmail.com"
            className="w-full px-2.5 py-1.5 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">SMTP Port</label>
          <input
            type="number"
            value={draft.smtpPort}
            onChange={(e) => setDraft({ ...draft, smtpPort: Number(e.target.value) || 0 })}
            className="w-full px-2.5 py-1.5 text-sm font-mono border border-surface-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1">
            Password {sender.senderEmail && <span className="normal-case text-surface-400">(leave blank to keep current)</span>}
          </label>
          <input
            type="password"
            value={draft.password}
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            placeholder={sender.senderEmail ? '••••••••' : undefined}
            className="w-full px-2.5 py-1.5 text-sm border border-surface-300 rounded-md"
          />
        </div>
        <div className="flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            id="enable-ssl"
            checked={draft.enableSsl}
            onChange={(e) => setDraft({ ...draft, enableSsl: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
          <label htmlFor="enable-ssl" className="text-sm text-surface-600">
            Enable SSL
          </label>
        </div>
      </div>
      {error && <p className="px-4 pb-2 text-[11px] text-status-critical">{error}</p>}
      <div className="px-4 py-3 border-t border-surface-100">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

interface RecipientRowProps {
  recipient: MailRecipient;
  devices: DeviceOption[];
}

// To: one recipient row - name/email editable inline, enabled toggle, and a
// per-device checkbox grid (a refinement of Form1.txt's coarser per-TR
// tr1/tr2 checkboxes) controlling which devices' alerts this person gets.
// Every mutation here is persisted to tms-backend immediately (no separate
// "Save" step for the toggles) since those are what the scheduled mail job
// reads.
function RecipientRow({ recipient, devices }: RecipientRowProps) {
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(recipient.name);
  const [emailDraft, setEmailDraft] = useState(recipient.email);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (nameDraft.trim() === '') {
      setError('Please enter a name');
      return;
    }
    if (!isValidEmail(emailDraft)) {
      setError('Please enter a valid email');
      return;
    }
    setError(null);
    try {
      // ManageMailSettingsUseCase.saveRecipient already writes its own
      // MAIL_CONFIG_CHANGE audit row server-side - don't double it here.
      await dispatch(
        saveRecipientAsync({ id: recipient.id, name: nameDraft, email: emailDraft, enabled: recipient.enabled, deviceIds: recipient.deviceIds })
      ).unwrap();
      dispatch(showToast('Recipient updated successfully'));
      setEditing(false);
    } catch {
      setError('Failed to save - is the backend reachable?');
    }
  };

  const handleToggleEnabled = () => {
    const wasEnabled = recipient.enabled;
    dispatch(toggleRecipientEnabledLocal({ id: recipient.id }));
    dispatch(
      saveRecipientAsync({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        enabled: !recipient.enabled,
        deviceIds: recipient.deviceIds,
      })
    )
      .unwrap()
      .then(() => dispatch(showToast(wasEnabled ? 'Recipient disabled successfully' : 'Recipient enabled successfully')));
  };

  const handleRemove = async () => {
    try {
      await dispatch(deleteRecipientAsync({ id: recipient.id })).unwrap();
      dispatch(showToast('Recipient removed successfully'));
    } catch {
      setError('Failed to remove - is the backend reachable?');
    }
  };

  const handleToggleDevice = (device: DeviceOption, wasChecked: boolean) => {
    dispatch(toggleRecipientDeviceLocal({ id: recipient.id, deviceId: device.id }));
    const nextDeviceIds = wasChecked
      ? recipient.deviceIds.filter((id) => id !== device.id)
      : [...recipient.deviceIds, device.id];
    dispatch(
      saveRecipientAsync({ id: recipient.id, name: recipient.name, email: recipient.email, enabled: recipient.enabled, deviceIds: nextDeviceIds })
    )
      .unwrap()
      .then(() => dispatch(showToast(wasChecked ? 'Device removed from recipient successfully' : 'Device added to recipient successfully')));
  };

  return (
    <div className="py-3 border-b border-surface-100 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          checked={recipient.enabled}
          onChange={handleToggleEnabled}
          title={recipient.enabled ? 'Enabled - click to disable' : 'Disabled - click to enable'}
          className="w-4 h-4 accent-primary"
        />
        {editing ? (
          <>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Name"
              className="w-40 px-2 py-1 text-sm border border-surface-300 rounded-md"
            />
            <input
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder="Email"
              className="flex-1 min-w-[200px] px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
            />
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition"
            >
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setNameDraft(recipient.name);
                setEmailDraft(recipient.email);
                setError(null);
              }}
              className="text-xs text-surface-500 hover:text-surface-700"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className={`w-40 text-sm ${recipient.enabled ? 'text-surface-800' : 'text-surface-400'}`}>
              {recipient.name}
            </span>
            <span className={`flex-1 min-w-[200px] text-sm font-mono ${recipient.enabled ? 'text-surface-600' : 'text-surface-400'}`}>
              {recipient.email}
            </span>
            <button onClick={() => setEditing(true)} className="text-xs font-semibold text-primary hover:text-primary-700">
              Edit
            </button>
          </>
        )}
        <button onClick={handleRemove} className="text-xs text-surface-400 hover:text-status-critical">
          Remove
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-status-critical">{error}</p>}

      {devices.length > 0 && (
        <div className="mt-2 ml-7 flex flex-wrap gap-x-4 gap-y-1.5">
          {devices.map((device) => {
            const checked = recipient.deviceIds.includes(device.id);
            return (
              <label key={device.id} className="flex items-center gap-1.5 text-xs text-surface-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => handleToggleDevice(device, checked)}
                  className="w-3.5 h-3.5 accent-primary"
                />
                {device.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A "don't send mail if a threshold is reached" control is really the
// threshold value itself (mirrors Form1.txt's email_Settings/
// email_TR2Settings screen) - each device gets its own set, editable here.
// Saved to both tms-backend (the scheduled job's real source of truth) and
// the local SubDevice.mailThresholds copy (so it's what's shown elsewhere
// in Settings without another round-trip).
function DeviceThresholdsRow({
  trId,
  gatewayId,
  deviceId,
  label,
  thresholds,
}: {
  trId: string;
  gatewayId: string;
  deviceId: string;
  label: string;
  thresholds: MailThresholds;
}) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<MailThresholds>(thresholds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // ManageMailSettingsUseCase.saveThresholds already writes its own
      // MAIL_CONFIG_CHANGE audit row server-side - don't double it here.
      await dispatch(saveMailThresholdsAsync({ ...draft, deviceId })).unwrap();
      dispatch(updateSubDeviceMailThresholds({ trId, gatewayId, deviceId, thresholds: draft }));
      dispatch(showToast('Mail thresholds updated successfully'));
    } catch {
      setError('Failed to save - is the backend reachable?');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof MailThresholds, fieldLabel: string, unit: string) => (
    <div className="flex items-center gap-1.5">
      <label className="text-xs text-surface-500 w-32">{fieldLabel}</label>
      <input
        type="number"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) || 0 })}
        className="w-20 px-2 py-1 text-sm font-mono border border-surface-300 rounded-md"
      />
      <span className="text-xs text-surface-400 w-8">{unit}</span>
    </div>
  );

  return (
    <div className="py-3 border-b border-surface-100 last:border-b-0">
      <p className="text-sm font-medium text-surface-700 mb-2">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {field('otiTempHigh', 'OTI High', '°C')}
        {field('wtiTempHigh', 'WTI High', '°C')}
        {field('avrHigh', 'AVR High', '%')}
        {field('avrLow', 'AVR Low', '%')}
        {field('tapHigh', 'Tap High', '')}
        {field('tapLow', 'Tap Low', '')}
        {field('mailTimeMinutes', 'Re-alert Every', 'min')}
      </div>
      {error && <p className="mt-1 text-[11px] text-status-critical">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save Thresholds'}
      </button>
    </div>
  );
}

// Mail Configuration (Settings > Mail Configuration) - mirrors Form1.txt's
// Mail Settings screen: sender SMTP settings (From), a recipient list (To)
// each opt-in per device rather than the legacy's coarser per-TR checkboxes,
// and per-device alert thresholds (email_Settings/email_TR2Settings). Sender
// settings and recipients are fetched from and saved to tms-backend, which
// also runs the scheduled job that actually evaluates thresholds and sends
// mail via JavaMailSender.
export function MailConfigurationCard() {
  const dispatch = useAppDispatch();
  const recipients = useAppSelector((state) => state.mailSettings.recipients);
  const isLoaded = useAppSelector((state) => state.mailSettings.isLoaded);
  const transformers = useAppSelector((state) => state.connectionSettings.transformers);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchMailSettingsAsync())
      .unwrap()
      .catch(() => setLoadError('Could not load mail settings from the backend - is it reachable?'));
  }, [dispatch]);

  const deviceOptions: DeviceOption[] = transformers.flatMap((tr) =>
    tr.gateways.flatMap((gw) =>
      gw.subDevices.map((device) => ({ id: device.id, label: `${tr.name} — ${gw.name} — ${device.name}` }))
    )
  );

  const handleAddRecipient = async () => {
    if (newName.trim() === '') {
      setAddError('Please enter a name');
      return;
    }
    if (!isValidEmail(newEmail)) {
      setAddError('Please enter a valid email');
      return;
    }
    setAddError(null);
    try {
      // ManageMailSettingsUseCase.saveRecipient already writes its own
      // MAIL_CONFIG_CHANGE audit row server-side - don't double it here.
      await dispatch(saveRecipientAsync({ name: newName, email: newEmail, enabled: true, deviceIds: [] })).unwrap();
      dispatch(showToast('Recipient added successfully'));
      setNewName('');
      setNewEmail('');
    } catch {
      setAddError('Failed to add recipient - is the backend reachable?');
    }
  };

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="px-4 py-2.5 rounded-lg bg-status-critical-soft text-status-critical text-sm font-medium">{loadError}</div>
      )}
      {!isLoaded && !loadError && (
        <div className="px-4 py-2.5 rounded-lg bg-surface-100 text-surface-500 text-sm font-medium">Loading mail settings…</div>
      )}

      <SenderSettingsSection />

      <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
        <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
          <p className="text-sm font-semibold text-surface-800">To — Recipients</p>
          <p className="text-xs text-surface-500 mt-0.5">
            Add as many recipients as needed; each can be enabled/disabled and opted in per device.
          </p>
        </div>

        <div className="px-4 py-3 border-b border-surface-100 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New recipient name"
              className="w-40 px-2.5 py-1.5 text-sm border border-surface-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Email</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-56 px-2.5 py-1.5 text-sm font-mono border border-surface-300 rounded-md"
            />
          </div>
          <button
            onClick={handleAddRecipient}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition"
          >
            + Add Recipient
          </button>
          {addError && <p className="text-[11px] text-status-critical basis-full">{addError}</p>}
        </div>

        <div className="px-4">
          {recipients.length === 0 ? (
            <p className="py-4 text-sm text-surface-500">No recipients added yet.</p>
          ) : (
            recipients.map((recipient) => (
              <RecipientRow key={recipient.id} recipient={recipient} devices={deviceOptions} />
            ))
          )}
        </div>
      </div>

      <div className="bg-surface-0 rounded-lg border border-surface-200 overflow-hidden">
        <div className="px-4 py-3 bg-surface-50 border-b border-surface-200">
          <p className="text-sm font-semibold text-surface-800">Alert Thresholds per Device</p>
          <p className="text-xs text-surface-500 mt-0.5">
            An alert is only sent once a device crosses its own thresholds - set a threshold beyond the
            device&apos;s normal operating range to effectively stop alerts for that condition.
          </p>
        </div>
        <div className="px-4">
          {transformers.flatMap((tr) =>
            tr.gateways.flatMap((gw) =>
              gw.subDevices.map((device) => (
                <DeviceThresholdsRow
                  key={device.id}
                  trId={tr.id}
                  gatewayId={gw.id}
                  deviceId={device.id}
                  label={`${tr.name} — ${gw.name} — ${device.name}`}
                  thresholds={device.mailThresholds}
                />
              ))
            )
          )}
          {deviceOptions.length === 0 && <p className="py-4 text-sm text-surface-500">No devices configured yet.</p>}
        </div>
      </div>
    </div>
  );
}
