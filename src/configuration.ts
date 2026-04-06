export interface OtelErrorLoggerConfig {
  /** OTLP logs endpoint (default: http://localhost:8080/v1/logs) */
  endpoint: string;
  /** API key for authentication (sent as x-api-key header) */
  apiKey?: string;
  /** Service name (sent as service.name resource attribute) */
  serviceName: string;
  /** Deployment environment (sent as deployment.environment) */
  environment?: string;
  /** Service version / release (sent as service.version) */
  release?: string;
  /** Max breadcrumbs to keep per error (default: 20) */
  maxBreadcrumbs: number;
  /** Max stack frames to include (default: 40) */
  maxStackFrames: number;
  /** Flush interval in ms for batched transport (default: 5000) */
  flushInterval: number;
  /** Max events to queue before forcing a flush (default: 100) */
  queueSize: number;
  /** Enable/disable the SDK (default: true) */
  enabled: boolean;
  /** Custom tags attached to every error */
  tags: Record<string, string>;
  /** Called before sending an event — return false to drop it */
  beforeSend?: (event: OtlpLogRecord) => OtlpLogRecord | false;
}

export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
}

export interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

const defaults: OtelErrorLoggerConfig = {
  endpoint: 'http://localhost:8080/v1/logs',
  serviceName: 'unknown-frontend',
  maxBreadcrumbs: 20,
  maxStackFrames: 40,
  flushInterval: 5000,
  queueSize: 100,
  enabled: true,
  tags: {},
};

let currentConfig: OtelErrorLoggerConfig = { ...defaults };

export function configure(overrides: Partial<OtelErrorLoggerConfig>): OtelErrorLoggerConfig {
  currentConfig = { ...defaults, ...overrides };
  return currentConfig;
}

export function getConfig(): OtelErrorLoggerConfig {
  return currentConfig;
}
