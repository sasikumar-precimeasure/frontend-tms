// Mail Configuration - mirrors Form1.txt's Mail Settings screen
// (senderEmail_Settings / Email_List / email_Settings tables + MailTimer_Tick).
// Sender settings and recipients are persisted to tms-backend (see
// features/mailSettings/slice.ts) - it's the real source of truth read by
// the backend's scheduled threshold-evaluation job, which actually sends
// mail via JavaMailSender. Per-device thresholds are edited here and saved
// to the backend the same way (see saveMailThresholdsAsync), while also
// staying on SubDevice.mailThresholds in connectionSettings/slice.ts as the
// local/offline display copy.

// From: one sender identity, app-wide (mirrors senderEmail_Settings, a
// single-row table - Form1.txt has no concept of multiple senders).
export interface MailSenderSettings {
  senderName: string;
  senderEmail: string;
  smtpHost: string;
  smtpPort: number;
  password: string;
  enableSsl: boolean;
}

export const DEFAULT_MAIL_SENDER_SETTINGS: MailSenderSettings = {
  senderName: '',
  senderEmail: '',
  smtpHost: '',
  smtpPort: 587,
  password: '',
  enableSsl: true,
};

// To: a recipient can be globally enabled/disabled (status) and additionally
// opted in/out per individual device (deviceIds) - a deliberate refinement
// of Form1.txt's coarser per-TR (tr1/tr2) checkboxes, since this app's
// gateway/device model is more granular than the legacy app's fixed TR1/TR2.
export interface MailRecipient {
  id: string;
  name: string;
  email: string;
  enabled: boolean;
  // Which device ids this recipient receives alerts for. A device not yet
  // seen by this recipient (added after the recipient was created) is
  // simply absent - treated as opted out until explicitly checked, same as
  // a fresh Email_List row's tr1/tr2 defaulting to unchecked in Form1.txt.
  deviceIds: string[];
}

// Threshold settings live on each device (mirrors email_Settings/
// email_TR2Settings, one row per TR in the legacy app - here, one set per
// device, matching this app's finer per-device granularity). mailTimeMinutes
// mirrors mail_Time: MailTimer_Tick only re-sends once this many ticks have
// elapsed since the last alert for that device, to avoid spamming the same
// ongoing condition every poll.
export interface MailThresholds {
  otiTempHigh: number;
  wtiTempHigh: number;
  avrHigh: number;
  avrLow: number;
  tapHigh: number;
  tapLow: number;
  mailTimeMinutes: number;
}

export const DEFAULT_MAIL_THRESHOLDS: MailThresholds = {
  otiTempHigh: 80,
  wtiTempHigh: 85,
  avrHigh: 20,
  avrLow: 20,
  tapHigh: 15,
  tapLow: 1,
  mailTimeMinutes: 10,
};
