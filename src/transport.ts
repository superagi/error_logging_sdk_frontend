import { getConfig } from './configuration';
import type { OtlpLogRecord } from './configuration';

let queue: OtlpLogRecord[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function enqueue(record: OtlpLogRecord): void {
  const config = getConfig();
  queue.push(record);

  if (queue.length >= config.queueSize) {
    flush();
  }
}

export function flush(): void {
  if (queue.length === 0) return;

  const config = getConfig();
  const records = queue.splice(0);

  const payload = {
    resourceLogs: [
      {
        resource: {
          attributes: buildResourceAttributes(config),
        },
        scopeLogs: [
          {
            scope: {
              name: '@superagi/otel-error-logger-js',
              version: '0.1.0',
            },
            logRecords: records,
          },
        ],
      },
    ],
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['x-api-key'] = config.apiKey;
  }

  // Use sendBeacon if available (works during page unload), fall back to fetch
  const body = JSON.stringify(payload);
  const endpoint = config.endpoint.replace(/\/+$/, '');
  const url = endpoint.endsWith('/v1/logs') ? endpoint : `${endpoint}/v1/logs`;

  if (typeof navigator !== 'undefined' && navigator.sendBeacon && !config.apiKey) {
    // sendBeacon doesn't support custom headers, so only use it when no apiKey
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(url, blob);
  } else if (typeof fetch !== 'undefined') {
    fetch(url, {
      method: 'POST',
      headers,
      body,
      keepalive: true,
    }).catch(() => {
      // Silently drop — we don't want error logging to cause errors
    });
  }
}

function buildResourceAttributes(config: ReturnType<typeof getConfig>) {
  const attrs = [
    { key: 'service.name', value: { stringValue: config.serviceName } },
    { key: 'telemetry.sdk.language', value: { stringValue: 'javascript' } },
    { key: 'telemetry.sdk.name', value: { stringValue: '@superagi/otel-error-logger-js' } },
  ];

  if (config.environment) {
    attrs.push({ key: 'deployment.environment', value: { stringValue: config.environment } });
  }
  if (config.release) {
    attrs.push({ key: 'service.version', value: { stringValue: config.release } });
  }

  return attrs;
}

export function startFlushTimer(): void {
  if (flushTimer) return;

  const config = getConfig();
  flushTimer = setInterval(() => flush(), config.flushInterval);

  // Flush on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', () => flush());
  }
}

export function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
