// Monthly report - schedule + recipients persisted to tms-backend, which
// builds the report (30-minute averages per device) and emails it as an
// .xlsx attachment. See tms-backend's MonthlyReportUseCase.

export interface MonthlyReportSettings {
  enabled: boolean;
  dayOfMonth: number; // 1-28
  sendTime: string; // "HH:mm", in `timezone`
  timezone: string; // IANA zone, e.g. "Asia/Kolkata"
  // Written by the backend scheduler only - "YYYY-MM" of the last month sent.
  lastSentPeriod: string | null;
  lastSentAt: string | null;
}

export interface MonthlyReportRecipient {
  id: string;
  name: string;
  email: string;
  enabled: boolean;
}

export const DEFAULT_MONTHLY_REPORT_SETTINGS: MonthlyReportSettings = {
  enabled: false,
  dayOfMonth: 1,
  sendTime: '06:00',
  timezone: 'Asia/Kolkata',
  lastSentPeriod: null,
  lastSentAt: null,
};
