import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../../app/store/hooks';
import type { MailRecipient, MailSenderSettings, MailThresholds } from '../../../domain/entities/MailSettings';
import {
  updateSender,
  addRecipient,
  updateRecipient,
  removeRecipient,
  toggleRecipientEnabled,
  toggleRecipientDevice,
} from '../../mailSettings/slice';
import { updateSubDeviceMailThresholds } from '../slice';

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
// app-wide sender, matching the legacy single-row table.
function SenderSettingsSection() {
  const dispatch = useAppDispatch();
  const sender = useAppSelector((state) => state.mailSettings.sender);
  const [draft, setDraft] = useState<MailSenderSettings>(sender);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
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
    dispatch(updateSender(draft));
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
          <label className="block text-xs font-medium text-surface-500 mb-1">Password</label>
          <input
            type="password"
            value={draft.password}
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
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
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition"
        >
          Save
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
function RecipientRow({ recipient, devices }: RecipientRowProps) {
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(recipient.name);
  const [emailDraft, setEmailDraft] = useState(recipient.email);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    if (nameDraft.trim() === '') {
      setError('Please enter a name');
      return;
    }
    if (!isValidEmail(emailDraft)) {
      setError('Please enter a valid email');
      return;
    }
    setError(null);
    dispatch(updateRecipient({ id: recipient.id, name: nameDraft, email: emailDraft }));
    setEditing(false);
  };

  return (
    <div className="py-3 border-b border-surface-100 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          checked={recipient.enabled}
          onChange={() => dispatch(toggleRecipientEnabled({ id: recipient.id }))}
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
        <button
          onClick={() => dispatch(removeRecipient({ id: recipient.id }))}
          className="text-xs text-surface-400 hover:text-status-critical"
        >
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
                  onChange={() => dispatch(toggleRecipientDevice({ id: recipient.id, deviceId: device.id }))}
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

  const handleSave = () => {
    dispatch(updateSubDeviceMailThresholds({ trId, gatewayId, deviceId, thresholds: draft }));
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
      <button
        onClick={handleSave}
        className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-white hover:bg-primary-700 transition"
      >
        Save Thresholds
      </button>
    </div>
  );
}

// Mail Configuration (Settings > Mail Configuration) - mirrors Form1.txt's
// Mail Settings screen: sender SMTP settings (From), a recipient list (To)
// each opt-in per device rather than the legacy's coarser per-TR checkboxes,
// and per-device alert thresholds (email_Settings/email_TR2Settings).
// Config only - nothing in this app sends an email yet, since the gateway
// server has no SMTP capability.
export function MailConfigurationCard() {
  const dispatch = useAppDispatch();
  const recipients = useAppSelector((state) => state.mailSettings.recipients);
  const transformers = useAppSelector((state) => state.connectionSettings.transformers);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const deviceOptions: DeviceOption[] = transformers.flatMap((tr) =>
    tr.gateways.flatMap((gw) =>
      gw.subDevices.map((device) => ({ id: device.id, label: `${tr.name} — ${gw.name} — ${device.name}` }))
    )
  );

  const handleAddRecipient = () => {
    if (newName.trim() === '') {
      setAddError('Please enter a name');
      return;
    }
    if (!isValidEmail(newEmail)) {
      setAddError('Please enter a valid email');
      return;
    }
    setAddError(null);
    dispatch(addRecipient({ name: newName, email: newEmail }));
    setNewName('');
    setNewEmail('');
  };

  return (
    <div className="space-y-4">
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
