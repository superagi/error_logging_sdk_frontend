interface OtelErrorLoggerConfig {
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
interface OtlpLogRecord {
    timeUnixNano: string;
    observedTimeUnixNano: string;
    severityNumber: number;
    severityText: string;
    body: {
        stringValue: string;
    };
    attributes: OtlpAttribute[];
}
interface OtlpAttribute {
    key: string;
    value: {
        stringValue: string;
    };
}
declare function getConfig(): OtelErrorLoggerConfig;

interface Breadcrumb {
    type: 'log' | 'click' | 'navigation' | 'fetch' | 'xhr';
    level: string;
    message: string;
    timestamp: string;
    data?: Record<string, string>;
}
declare function addBreadcrumb(crumb: Breadcrumb): void;

declare function captureException(error: Error | string, extra?: {
    extra?: Record<string, string>;
    user?: {
        id?: string;
        email?: string;
    };
    tags?: Record<string, string>;
}): void;

declare function flush(): void;

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
declare function init(options: Partial<OtelErrorLoggerConfig> & {
    serviceName: string;
}): void;
/**
 * Tear down the SDK — removes all global handlers, stops the flush timer,
 * and sends any remaining queued events.
 */
declare function destroy(): void;

export { type Breadcrumb, type OtelErrorLoggerConfig, type OtlpAttribute, type OtlpLogRecord, addBreadcrumb, captureException, destroy, flush, getConfig, init };
