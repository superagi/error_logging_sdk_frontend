import { getConfig } from './configuration';
import { getBreadcrumbs, clearBreadcrumbs } from './breadcrumbs';
import { enqueue } from './transport';
import { parseUserAgent } from './user_agent';
import { getSessionId, getSessionStartedAt } from './session';
import { getDeviceContextAttributes } from './device_context';
import { getWebVitals } from './web_vitals';
import type { OtlpLogRecord, OtlpAttribute } from './configuration';

// PII filters — same patterns as Ruby/Python loggers
const SENSITIVE_COOKIE_PATTERNS = [
  /_session/i, /csrf/i, /token/i, /auth/i, /secret/i, /key/i,
];

const SENSITIVE_PARAM_PATTERNS = [
  /password/i, /token/i, /secret/i, /api_key/i, /credit_card/i, /auth/i,
];

function parseCookies(cookieString: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieString) return cookies;
  for (const pair of cookieString.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

let installed = false;
let onErrorHandler: OnErrorEventHandler = null;
let onUnhandledRejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

export function captureException(
  error: Error | string,
  extra?: {
    extra?: Record<string, string>;
    user?: { id?: string; email?: string };
    tags?: Record<string, string>;
  },
): void {
  const config = getConfig();
  if (!config.enabled) return;

  const err = typeof error === 'string' ? new Error(error) : error;
  const now = String(Date.now() * 1_000_000); // nanoseconds

  const attributes: OtlpAttribute[] = [
    { key: 'exception.type', value: { stringValue: err.name || 'Error' } },
    { key: 'exception.message', value: { stringValue: err.message } },
    { key: 'exception.stacktrace', value: { stringValue: truncateStack(err.stack || '', config.maxStackFrames) } },
    { key: 'breadcrumbs', value: { stringValue: JSON.stringify(getBreadcrumbs()) } },
    { key: 'log.source', value: { stringValue: 'browser' } },
  ];

  // Session context
  const sid = getSessionId();
  if (sid) {
    attributes.push({ key: 'session.id', value: { stringValue: sid } });
  }
  const sessionStart = getSessionStartedAt();
  if (sessionStart) {
    attributes.push({ key: 'session.started_at', value: { stringValue: sessionStart } });
  }

  // Browser context
  if (typeof window !== 'undefined') {
    attributes.push({ key: 'browser.url', value: { stringValue: window.location.href } });
    attributes.push({ key: 'browser.user_agent', value: { stringValue: navigator.userAgent } });
    attributes.push({ key: 'browser.language', value: { stringValue: navigator.language } });
    attributes.push({ key: 'browser.viewport', value: { stringValue: `${window.innerWidth}x${window.innerHeight}` } });

    // Parsed user agent (browser, OS, device type)
    const ua = parseUserAgent(navigator.userAgent);
    attributes.push({ key: 'browser.name', value: { stringValue: ua.browser.name } });
    attributes.push({ key: 'browser.version', value: { stringValue: ua.browser.version } });
    attributes.push({ key: 'os.name', value: { stringValue: ua.os.name } });
    attributes.push({ key: 'os.version', value: { stringValue: ua.os.version } });
    attributes.push({ key: 'device.type', value: { stringValue: ua.device.type } });

    // Device context (screen, memory, cores, network)
    attributes.push(...getDeviceContextAttributes());

    // Web vitals snapshot (latest values at time of error)
    const vitals = getWebVitals();
    for (const [name, value] of Object.entries(vitals)) {
      attributes.push({ key: `web_vital.${name}`, value: { stringValue: String(Math.round(value * 100) / 100) } });
    }

    // Cookies (filtered for PII)
    const cookies: Record<string, string> = parseCookies(document.cookie);
    for (const [name, value] of Object.entries(cookies) as [string, string][]) {
      if (!SENSITIVE_COOKIE_PATTERNS.some((p: RegExp) => p.test(name))) {
        attributes.push({ key: `http.request.cookie.${name}`, value: { stringValue: value } });
      }
    }

    // URL query params (filtered for PII)
    const params = new URLSearchParams(window.location.search);
    params.forEach((value: string, name: string) => {
      if (!SENSITIVE_PARAM_PATTERNS.some((p: RegExp) => p.test(name))) {
        attributes.push({ key: `http.request.param.${name}`, value: { stringValue: value } });
      }
    });

    // localStorage keys (just names, not values — for debugging context)
    try {
      const storageKeys = Object.keys(localStorage);
      if (storageKeys.length > 0) {
        attributes.push({ key: 'browser.local_storage_keys', value: { stringValue: storageKeys.join(', ') } });
      }
    } catch { /* storage access may be blocked */ }
  }

  // Custom tags (from config + per-call)
  const allTags = { ...config.tags, ...extra?.tags };
  for (const [k, v] of Object.entries(allTags)) {
    attributes.push({ key: `tag.${k}`, value: { stringValue: v } });
  }

  // User context
  if (extra?.user?.id) {
    attributes.push({ key: 'user.id', value: { stringValue: extra.user.id } });
  }
  if (extra?.user?.email) {
    attributes.push({ key: 'user.email', value: { stringValue: extra.user.email } });
  }

  // Extra data
  if (extra?.extra) {
    for (const [k, v] of Object.entries(extra.extra)) {
      attributes.push({ key: `extra.${k}`, value: { stringValue: v } });
    }
  }

  let logRecord: OtlpLogRecord = {
    timeUnixNano: now,
    observedTimeUnixNano: now,
    severityNumber: 17,
    severityText: 'ERROR',
    body: { stringValue: `${err.name}: ${err.message}` },
    attributes,
  };

  // beforeSend hook
  if (config.beforeSend) {
    const result = config.beforeSend(logRecord);
    if (result === false) return;
    logRecord = result;
  }

  enqueue(logRecord);
  clearBreadcrumbs();
}

function truncateStack(stack: string, maxFrames: number): string {
  const lines = stack.split('\n');
  return lines.slice(0, maxFrames + 1).join('\n'); // +1 for the error message line
}

export function installGlobalHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // window.onerror — catches runtime errors
  onErrorHandler = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ) => {
    const err = error || new Error(String(message));
    captureException(err, {
      extra: {
        ...(source ? { source } : {}),
        ...(lineno != null ? { lineno: String(lineno) } : {}),
        ...(colno != null ? { colno: String(colno) } : {}),
      },
    });
  };
  window.onerror = onErrorHandler;

  // unhandledrejection — catches unhandled promise rejections
  onUnhandledRejectionHandler = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureException(err, { tags: { mechanism: 'unhandledrejection' } });
  };
  window.addEventListener('unhandledrejection', onUnhandledRejectionHandler);
}

export function uninstallGlobalHandlers(): void {
  if (!installed || typeof window === 'undefined') return;
  installed = false;

  window.onerror = null;
  if (onUnhandledRejectionHandler) {
    window.removeEventListener('unhandledrejection', onUnhandledRejectionHandler);
  }
}
