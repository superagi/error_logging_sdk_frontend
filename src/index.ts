import { configure, getConfig } from './configuration';
import type { OtelErrorLoggerConfig, OtlpLogRecord, OtlpAttribute } from './configuration';
import { installBreadcrumbs, uninstallBreadcrumbs, addBreadcrumb, setConsoleErrorCallback } from './breadcrumbs';
import type { Breadcrumb } from './breadcrumbs';
import { captureException, installGlobalHandlers, uninstallGlobalHandlers } from './error_capture';
import { startFlushTimer, stopFlushTimer, flush } from './transport';
import { installWebVitals, uninstallWebVitals } from './web_vitals';
import { installResourceErrorCapture, uninstallResourceErrorCapture } from './resource_errors';
import { initSession } from './session';

/**
 * Initialize the error logger SDK.
 *
 * Call this once at app startup, before any other code runs:
 *
 * ```ts
 * import { init } from '@superagi/otel-error-logger-js';
 *
 * init({
 *   serviceName: 'my-frontend',
 *   environment: 'production',
 *   endpoint: 'https://otel-collector.example.com/v1/logs',
 *   apiKey: 'your-api-key',
 *   release: '1.0.0',
 * });
 * ```
 */
function init(options: Partial<OtelErrorLoggerConfig> & { serviceName: string }): void {
  configure(options);

  const config = getConfig();
  if (!config.enabled) return;

  initSession();
  installBreadcrumbs();
  setConsoleErrorCallback((err) => captureException(err, { tags: { mechanism: 'console.error' } }));
  installGlobalHandlers();
  installResourceErrorCapture();
  installWebVitals();
  startFlushTimer();
}

/**
 * Tear down the SDK — removes all global handlers, stops the flush timer,
 * and sends any remaining queued events.
 */
function destroy(): void {
  flush();
  uninstallBreadcrumbs();
  uninstallGlobalHandlers();
  uninstallResourceErrorCapture();
  uninstallWebVitals();
  stopFlushTimer();
}

export {
  init,
  destroy,
  captureException,
  addBreadcrumb,
  flush,
  getConfig,
};

export type {
  OtelErrorLoggerConfig,
  OtlpLogRecord,
  OtlpAttribute,
  Breadcrumb,
};
