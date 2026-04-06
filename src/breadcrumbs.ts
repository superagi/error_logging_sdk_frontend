import { getConfig } from './configuration';

export interface Breadcrumb {
  type: 'log' | 'click' | 'navigation' | 'fetch' | 'xhr';
  level: string;
  message: string;
  timestamp: string;
  data?: Record<string, string>;
}

let breadcrumbs: Breadcrumb[] = [];
let onConsoleErrorCallback: ((err: Error) => void) | null = null;

export function setConsoleErrorCallback(cb: (err: Error) => void): void {
  onConsoleErrorCallback = cb;
}

let installed = false;

// Store originals for restoration
let originalConsoleError: typeof console.error;
let originalConsoleWarn: typeof console.warn;
let originalConsoleLog: typeof console.log;
let originalConsoleDebug: typeof console.debug;
let originalFetch: typeof globalThis.fetch;
let originalXHROpen: typeof XMLHttpRequest.prototype.open;
let originalXHRSend: typeof XMLHttpRequest.prototype.send;
let clickHandler: ((e: MouseEvent) => void) | null = null;
let popstateHandler: (() => void) | null = null;

export function getBreadcrumbs(): Breadcrumb[] {
  return [...breadcrumbs];
}

export function clearBreadcrumbs(): void {
  breadcrumbs = [];
}

export function addBreadcrumb(crumb: Breadcrumb): void {
  const max = getConfig().maxBreadcrumbs;
  breadcrumbs.push(crumb);
  if (breadcrumbs.length > max) {
    breadcrumbs = breadcrumbs.slice(-max);
  }
}

function instrumentConsole(): void {
  originalConsoleLog = console.log;
  originalConsoleDebug = console.debug;
  originalConsoleWarn = console.warn;
  originalConsoleError = console.error;

  const wrap = (level: string, original: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      addBreadcrumb({
        type: 'log',
        level,
        message: args.map(String).join(' '),
        timestamp: new Date().toISOString(),
      });
      original.apply(console, args);
    };
  };

  console.debug = wrap('debug', originalConsoleDebug);
  console.log = wrap('info', originalConsoleLog);
  console.warn = wrap('warning', originalConsoleWarn);

  // Wrap console.error — capture as actual errors + breadcrumb
  console.error = (...args: unknown[]) => {
    const message = args.map(String).join(' ');

    addBreadcrumb({
      type: 'log',
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
    });

    // Lazily import to avoid circular dependency
    const err = args[0] instanceof Error ? args[0] : new Error(message);
    err.name = err.name === 'Error' ? 'ConsoleError' : err.name;

    // Fire and forget — will be picked up by onConsoleError callback if set
    if (onConsoleErrorCallback) {
      onConsoleErrorCallback(err);
    }

    originalConsoleError.apply(console, args);
  };
}

function instrumentClicks(): void {
  if (typeof document === 'undefined') return;

  clickHandler = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const tag = target.tagName?.toLowerCase() || '';
    const id = target.id ? `#${target.id}` : '';
    const cls = target.className && typeof target.className === 'string'
      ? `.${target.className.split(' ').join('.')}`
      : '';
    const text = target.textContent?.slice(0, 50) || '';

    addBreadcrumb({
      type: 'click',
      level: 'info',
      message: `${tag}${id}${cls}`,
      timestamp: new Date().toISOString(),
      data: text ? { text } : undefined,
    });
  };

  document.addEventListener('click', clickHandler, { capture: true });
}

function instrumentNavigation(): void {
  if (typeof window === 'undefined') return;

  // Wrap pushState and replaceState
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    addBreadcrumb({
      type: 'navigation',
      level: 'info',
      message: `pushState → ${args[2] || ''}`,
      timestamp: new Date().toISOString(),
      data: { from: location.href, to: String(args[2] || '') },
    });
    return originalPushState.apply(this, args);
  };

  history.replaceState = function (...args) {
    addBreadcrumb({
      type: 'navigation',
      level: 'info',
      message: `replaceState → ${args[2] || ''}`,
      timestamp: new Date().toISOString(),
      data: { from: location.href, to: String(args[2] || '') },
    });
    return originalReplaceState.apply(this, args);
  };

  popstateHandler = () => {
    addBreadcrumb({
      type: 'navigation',
      level: 'info',
      message: `popstate → ${location.href}`,
      timestamp: new Date().toISOString(),
    });
  };
  window.addEventListener('popstate', popstateHandler);
}

function instrumentFetch(): void {
  if (typeof globalThis.fetch === 'undefined') return;

  originalFetch = globalThis.fetch;

  globalThis.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const method = init?.method || 'GET';
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const startTime = Date.now();

    try {
      const response = await originalFetch.call(globalThis, input, init);
      addBreadcrumb({
        type: 'fetch',
        level: response.ok ? 'info' : 'warning',
        message: `${method} ${url} → ${response.status}`,
        timestamp: new Date().toISOString(),
        data: { duration_ms: String(Date.now() - startTime) },
      });
      return response;
    } catch (err) {
      addBreadcrumb({
        type: 'fetch',
        level: 'error',
        message: `${method} ${url} → network error`,
        timestamp: new Date().toISOString(),
        data: { error: String(err), duration_ms: String(Date.now() - startTime) },
      });
      throw err;
    }
  };
}

function instrumentXHR(): void {
  if (typeof XMLHttpRequest === 'undefined') return;

  originalXHROpen = XMLHttpRequest.prototype.open;
  originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
    (this as XMLHttpRequest & { _otel_method: string; _otel_url: string })._otel_method = method;
    (this as XMLHttpRequest & { _otel_url: string })._otel_url = String(url);
    return (originalXHROpen as Function).call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    const xhr = this as XMLHttpRequest & { _otel_method: string; _otel_url: string };
    const startTime = Date.now();

    this.addEventListener('loadend', () => {
      addBreadcrumb({
        type: 'xhr',
        level: this.status >= 400 ? 'warning' : 'info',
        message: `${xhr._otel_method} ${xhr._otel_url} → ${this.status}`,
        timestamp: new Date().toISOString(),
        data: { duration_ms: String(Date.now() - startTime) },
      });
    });

    return originalXHRSend.call(this, body);
  };
}

export function installBreadcrumbs(): void {
  if (installed) return;
  installed = true;

  instrumentConsole();
  instrumentClicks();
  instrumentNavigation();
  instrumentFetch();
  instrumentXHR();
}

export function uninstallBreadcrumbs(): void {
  if (!installed) return;
  installed = false;

  // Restore console
  console.log = originalConsoleLog;
  console.debug = originalConsoleDebug;
  console.warn = originalConsoleWarn;

  // Restore fetch
  if (originalFetch) globalThis.fetch = originalFetch;

  // Restore XHR
  if (originalXHROpen) XMLHttpRequest.prototype.open = originalXHROpen;
  if (originalXHRSend) XMLHttpRequest.prototype.send = originalXHRSend;

  // Remove event listeners
  if (clickHandler && typeof document !== 'undefined') {
    document.removeEventListener('click', clickHandler, { capture: true });
  }
  if (popstateHandler && typeof window !== 'undefined') {
    window.removeEventListener('popstate', popstateHandler);
  }

  clearBreadcrumbs();
}
