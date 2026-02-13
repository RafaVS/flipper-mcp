// Definiciones de tipos para Flipper Messages

export interface FlipperMessage {
  event: string;
  payload?: Record<string, unknown>;
}

export interface DeviceLogEntry {
  date: string;
  tag: string;
  type: "verbose" | "debug" | "info" | "warn" | "error";
  pid: number;
  tid: number;
  app: string;
  message: string;
}

export interface MeliaEvent {
  id: number;
  date: string;
  /** Raw event string, e.g. "GA: {\"type\":\"screen_view\",...}" */
  event: string;
  /** Event type name, e.g. "screen_view", "purchase" */
  origin: string;
}

export interface NetworkRequest {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  data: string | null;
}

export interface NetworkResponse {
  id: string;
  timestamp: number;
  status: number;
  headers: { key: string; value: string }[];
  data: string | null;
  totalChunks: number;
  index: number;
  isMock: boolean;
}

export interface ViewModelState {
  id: number;
  viewModel: string;
  action: "Init" | "Update" | "Clear";
  date: string;
  differences: Record<string, unknown>;
  state: Record<string, unknown>;
}

export interface PreferenceChange {
  preferences: string;
  name: string;
  value: unknown;
  deleted: boolean;
  time: number;
}

export interface CrashLog {
  callstack: string;
  name: string;
  reason: string;
  date?: number;
}
