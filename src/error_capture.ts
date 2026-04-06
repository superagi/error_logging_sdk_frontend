import { getConfig } from './configuration';
import { getBreadcrumbs, clearBreadcrumbs } from './breadcrumbs';
import { enqueue } from './transport';
import type { OtlpLogRecord, OtlpAttribute } from './configuration';

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

  // Browser context
  if (typeof window !== 'undefined') {
    attributes.push({ key: 'browser.url', value: { stringValue: window.location.href } });
    attributes.push({ key: 'browser.user_agent', value: { stringValue: navigator.userAgent } });
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
