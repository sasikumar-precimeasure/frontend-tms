import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { AxiosError } from 'axios';
import type { Dependencies } from '../../app/dependencies';
import type { MonthlyReportRecipient, MonthlyReportSettings } from '../../domain/entities/MonthlyReport';
import { DEFAULT_MONTHLY_REPORT_SETTINGS } from '../../domain/entities/MonthlyReport';

const BASE = '/tms/api/reports/monthly';

// The backend's ApiResponseDto.error(...) carries a human-readable reason
// (e.g. "No enabled monthly report recipients") - surface that, not Axios's
// generic "Request failed with status code 409".
export function extractReportErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return 'An unknown error occurred';
}

export const fetchMonthlyReportAsync = createAsyncThunk<
  { settings: MonthlyReportSettings; recipients: MonthlyReportRecipient[] },
  void,
  { extra: Dependencies }
>('monthlyReport/fetch', async (_, { extra }) => {
  const client = extra.infrastructure.apiClient;
  const [settings, recipients] = await Promise.all([
    client.get<MonthlyReportSettings>(`${BASE}/settings`),
    client.get<MonthlyReportRecipient[]>(`${BASE}/recipients`),
  ]);
  return { settings: settings.data, recipients: recipients.data };
});

export const saveMonthlyReportSettingsAsync = createAsyncThunk<
  MonthlyReportSettings,
  MonthlyReportSettings,
  { extra: Dependencies; rejectValue: string }
>('monthlyReport/saveSettings', async (settings, { extra, rejectWithValue }) => {
  try {
    const response = await extra.infrastructure.apiClient.put<MonthlyReportSettings>(`${BASE}/settings`, settings);
    return response.data;
  } catch (error) {
    return rejectWithValue(extractReportErrorMessage(error));
  }
});

export const saveMonthlyReportRecipientAsync = createAsyncThunk<
  MonthlyReportRecipient,
  Omit<MonthlyReportRecipient, 'id'> & { id?: string },
  { extra: Dependencies; rejectValue: string }
>('monthlyReport/saveRecipient', async (recipient, { extra, rejectWithValue }) => {
  try {
    const response = await extra.infrastructure.apiClient.post<MonthlyReportRecipient>(`${BASE}/recipients`, recipient);
    return response.data;
  } catch (error) {
    return rejectWithValue(extractReportErrorMessage(error));
  }
});

export const deleteMonthlyReportRecipientAsync = createAsyncThunk<{ id: string }, { id: string }, { extra: Dependencies }>(
  'monthlyReport/deleteRecipient',
  async ({ id }, { extra }) => {
    await extra.infrastructure.apiClient.delete(`${BASE}/recipients/${id}`);
    return { id };
  }
);

// `month` is "YYYY-MM". No reducer case - a plain browser download.
export const downloadMonthlyReportAsync = createAsyncThunk<void, { month: string }, { extra: Dependencies; rejectValue: string }>(
  'monthlyReport/download',
  async ({ month }, { extra, rejectWithValue }) => {
    try {
      const response = await extra.infrastructure.apiClient.get(`${BASE}/download`, {
        params: { month },
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `transformer-report-${month}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      return rejectWithValue(extractReportErrorMessage(error));
    }
  }
);

export const sendMonthlyReportNowAsync = createAsyncThunk<
  { month: string; recipientCount: number },
  { month: string },
  { extra: Dependencies; rejectValue: string }
>('monthlyReport/sendNow', async ({ month }, { extra, rejectWithValue }) => {
  try {
    const response = await extra.infrastructure.apiClient.post<{ month: string; recipientCount: number }>(
      `${BASE}/send`,
      null,
      { params: { month } }
    );
    return response.data;
  } catch (error) {
    return rejectWithValue(extractReportErrorMessage(error));
  }
});

interface MonthlyReportState {
  settings: MonthlyReportSettings;
  recipients: MonthlyReportRecipient[];
  loaded: boolean;
  loadError: string | null;
}

const initialState: MonthlyReportState = {
  settings: DEFAULT_MONTHLY_REPORT_SETTINGS,
  recipients: [],
  loaded: false,
  loadError: null,
};

const monthlyReportSlice = createSlice({
  name: 'monthlyReport',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchMonthlyReportAsync.fulfilled, (state, action) => {
        state.settings = action.payload.settings;
        state.recipients = action.payload.recipients;
        state.loaded = true;
        state.loadError = null;
      })
      .addCase(fetchMonthlyReportAsync.rejected, (state, action) => {
        state.loadError = action.error.message ?? 'Failed to load monthly report settings';
      })
      .addCase(saveMonthlyReportSettingsAsync.fulfilled, (state, action) => {
        state.settings = action.payload;
      })
      .addCase(saveMonthlyReportRecipientAsync.fulfilled, (state, action) => {
        const index = state.recipients.findIndex((r) => r.id === action.payload.id);
        if (index >= 0) state.recipients[index] = action.payload;
        else state.recipients.push(action.payload);
      })
      .addCase(deleteMonthlyReportRecipientAsync.fulfilled, (state, action) => {
        state.recipients = state.recipients.filter((r) => r.id !== action.payload.id);
      });
  },
});

export default monthlyReportSlice.reducer;
