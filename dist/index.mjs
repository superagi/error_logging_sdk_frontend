// src/configuration.ts
var defaults = {
  endpoint: "http://localhost:8080/v1/logs",
  serviceName: "unknown-frontend",
  maxBreadcrumbs: 20,
  maxStackFrames: 40,
  flushInterval: 5e3,
  queueSize: 100,
  enabled: true,
  tags: {}
};
var currentConfig = { ...defaults };
function configure(overrides) {
  currentConfig = { ...defaults, ...overrides };
  return currentConfig;
}
function getConfig() {
  return currentConfig;
}

// src/breadcrumbs.ts
var breadcrumbs = [];
var installed = false;
var originalConsoleError;
var originalConsoleWarn;
var originalConsoleLog;
var originalConsoleDebug;
var originalFetch;
var originalXHROpen;
var originalXHRSend;
var clickHandler = null;
var popstateHandler = null;
function getBreadcrumbs() {
  return [...breadcrumbs];
}
function clearBreadcrumbs() {
  breadcrumbs = [];
}
function addBreadcrumb(crumb) {
  const max = getConfig().maxBreadcrumbs;
  breadcrumbs.push(crumb);
  if (breadcrumbs.length > max) {
    breadcrumbs = breadcrumbs.slice(-max);
  }
}
function instrumentConsole() {
  originalConsoleLog = console.log;
  originalConsoleDebug = console.debug;
  originalConsoleWarn = console.warn;
  originalConsoleError = console.error;
  const wrap = (level, original) => {
    return (...args) => {
      addBreadcrumb({
        type: "log",
        level,
        message: args.map(String).join(" "),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      original.apply(console, args);
    };
  };
  console.debug = wrap("debug", originalConsoleDebug);
  console.log = wrap("info", originalConsoleLog);
  console.warn = wrap("warning", originalConsoleWarn);
  console.error = wrap("error", originalConsoleError);
}
function instrumentClicks() {
  if (typeof document === "undefined") return;
  clickHandler = (event) => {
    const target = event.target;
    if (!target) return;
    const tag = target.tagName?.toLowerCase() || "";
    const id = target.id ? `#${target.id}` : "";
    const cls = target.className && typeof target.className === "string" ? `.${target.className.split(" ").join(".")}` : "";
    const text = target.textContent?.slice(0, 50) || "";
    addBreadcrumb({
      type: "click",
      level: "info",
      message: `${tag}${id}${cls}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data: text ? { text } : void 0
    });
  };
  document.addEventListener("click", clickHandler, { capture: true });
}
function instrumentNavigation() {
  if (typeof window === "undefined") return;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function(...args) {
    addBreadcrumb({
      type: "navigation",
      level: "info",
      message: `pushState \u2192 ${args[2] || ""}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data: { from: location.href, to: String(args[2] || "") }
    });
    return originalPushState.apply(this, args);
  };
  history.replaceState = function(...args) {
    addBreadcrumb({
      type: "navigation",
      level: "info",
      message: `replaceState \u2192 ${args[2] || ""}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data: { from: location.href, to: String(args[2] || "") }
    });
    return originalReplaceState.apply(this, args);
  };
  popstateHandler = () => {
    addBreadcrumb({
      type: "navigation",
      level: "info",
      message: `popstate \u2192 ${location.href}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  };
  window.addEventListener("popstate", popstateHandler);
}
function instrumentFetch() {
  if (typeof globalThis.fetch === "undefined") return;
  originalFetch = globalThis.fetch;
  globalThis.fetch = async function(input, init2) {
    const method = init2?.method || "GET";
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const startTime = Date.now();
    try {
      const response = await originalFetch.call(globalThis, input, init2);
      addBreadcrumb({
        type: "fetch",
        level: response.ok ? "info" : "warning",
        message: `${method} ${url} \u2192 ${response.status}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { duration_ms: String(Date.now() - startTime) }
      });
      return response;
    } catch (err) {
      addBreadcrumb({
        type: "fetch",
        level: "error",
        message: `${method} ${url} \u2192 network error`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { error: String(err), duration_ms: String(Date.now() - startTime) }
      });
      throw err;
    }
  };
}
function instrumentXHR() {
  if (typeof XMLHttpRequest === "undefined") return;
  originalXHROpen = XMLHttpRequest.prototype.open;
  originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._otel_method = method;
    this._otel_url = String(url);
    return originalXHROpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    const startTime = Date.now();
    this.addEventListener("loadend", () => {
      addBreadcrumb({
        type: "xhr",
        level: this.status >= 400 ? "warning" : "info",
        message: `${xhr._otel_method} ${xhr._otel_url} \u2192 ${this.status}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        data: { duration_ms: String(Date.now() - startTime) }
      });
    });
    return originalXHRSend.call(this, body);
  };
}
function installBreadcrumbs() {
  if (installed) return;
  installed = true;
  instrumentConsole();
  instrumentClicks();
  instrumentNavigation();
  instrumentFetch();
  instrumentXHR();
}
function uninstallBreadcrumbs() {
  if (!installed) return;
  installed = false;
  console.log = originalConsoleLog;
  console.debug = originalConsoleDebug;
  console.warn = originalConsoleWarn;
  if (originalFetch) globalThis.fetch = originalFetch;
  if (originalXHROpen) XMLHttpRequest.prototype.open = originalXHROpen;
  if (originalXHRSend) XMLHttpRequest.prototype.send = originalXHRSend;
  if (clickHandler && typeof document !== "undefined") {
    document.removeEventListener("click", clickHandler, { capture: true });
  }
  if (popstateHandler && typeof window !== "undefined") {
    window.removeEventListener("popstate", popstateHandler);
  }
  clearBreadcrumbs();
}

// src/transport.ts
var queue = [];
var flushTimer = null;
function enqueue(record) {
  const config = getConfig();
  queue.push(record);
  if (queue.length >= config.queueSize) {
    flush();
  }
}
function flush() {
  if (queue.length === 0) return;
  const config = getConfig();
  const records = queue.splice(0);
  const payload = {
    resourceLogs: [
      {
        resource: {
          attributes: buildResourceAttributes(config)
        },
        scopeLogs: [
          {
            scope: {
              name: "@superagi/otel-error-logger-js",
              version: "0.1.0"
            },
            logRecords: records
          }
        ]
      }
    ]
  };
  const headers = {
    "Content-Type": "application/json"
  };
  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }
  const body = JSON.stringify(payload);
  const endpoint = config.endpoint.replace(/\/+$/, "");
  const url = endpoint.endsWith("/v1/logs") ? endpoint : `${endpoint}/v1/logs`;
  if (typeof navigator !== "undefined" && navigator.sendBeacon && !config.apiKey) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(url, blob);
  } else if (typeof fetch !== "undefined") {
    fetch(url, {
      method: "POST",
      headers,
      body,
      keepalive: true
    }).catch(() => {
    });
  }
}
function buildResourceAttributes(config) {
  const attrs = [
    { key: "service.name", value: { stringValue: config.serviceName } },
    { key: "telemetry.sdk.language", value: { stringValue: "javascript" } },
    { key: "telemetry.sdk.name", value: { stringValue: "@superagi/otel-error-logger-js" } }
  ];
  if (config.environment) {
    attrs.push({ key: "deployment.environment", value: { stringValue: config.environment } });
  }
  if (config.release) {
    attrs.push({ key: "service.version", value: { stringValue: config.release } });
  }
  return attrs;
}
function startFlushTimer() {
  if (flushTimer) return;
  const config = getConfig();
  flushTimer = setInterval(() => flush(), config.flushInterval);
  if (typeof window !== "undefined") {
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", () => flush());
  }
}
function stopFlushTimer() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// src/user_agent.ts
function parseUserAgent(ua) {
  return {
    browser: parseBrowser(ua),
    os: parseOS(ua),
    device: { type: parseDeviceType(ua) }
  };
}
function parseBrowser(ua) {
  const tests = [
    [/Edg(?:e|A|iOS)?\/(\S+)/, "Edge"],
    [/OPR\/(\S+)/, "Opera"],
    [/SamsungBrowser\/(\S+)/, "Samsung Internet"],
    [/UCBrowser\/(\S+)/, "UC Browser"],
    [/Chrome\/(\S+)/, "Chrome"],
    [/Firefox\/(\S+)/, "Firefox"],
    [/Version\/(\S+).*Safari/, "Safari"],
    [/MSIE\s(\S+)/, "IE"],
    [/Trident.*rv:(\S+)/, "IE"]
  ];
  for (const [re, name] of tests) {
    const match = ua.match(re);
    if (match) return { name, version: match[1] || "unknown" };
  }
  return { name: "unknown", version: "unknown" };
}
function parseOS(ua) {
  const tests = [
    [/Windows NT (\S+)/, "Windows"],
    [/Mac OS X ([_\d]+)/, "macOS"],
    [/iPhone OS ([_\d]+)/, "iOS"],
    [/iPad.*OS ([_\d]+)/, "iPadOS"],
    [/Android (\S+)/, "Android"],
    [/CrOS [^\s]+ ([\d.]+)/, "Chrome OS"],
    [/Linux/, "Linux"]
  ];
  for (const [re, name] of tests) {
    const match = ua.match(re);
    if (match) {
      const version = (match[1] || "unknown").replace(/_/g, ".");
      return { name, version };
    }
  }
  return { name: "unknown", version: "unknown" };
}
function parseDeviceType(ua) {
  if (/iPad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/Mobile|Android.*Chrome\/[.0-9]* (?!.*Safari)|iPhone|iPod|Opera Mini|IEMobile/i.test(ua)) return "mobile";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "unknown";
}

// src/session.ts
var sessionId = null;
var sessionStartedAt = null;
function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function initSession() {
  if (typeof sessionStorage !== "undefined") {
    try {
      const stored = sessionStorage.getItem("_otel_error_session");
      if (stored) {
        const parsed = JSON.parse(stored);
        sessionId = parsed.id;
        sessionStartedAt = parsed.startedAt;
        return;
      }
    } catch {
    }
  }
  sessionId = generateId();
  sessionStartedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem("_otel_error_session", JSON.stringify({
        id: sessionId,
        startedAt: sessionStartedAt
      }));
    } catch {
    }
  }
}
function getSessionId() {
  return sessionId;
}
function getSessionStartedAt() {
  return sessionStartedAt;
}

// src/device_context.ts
function getDeviceContextAttributes() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return [];
  const nav = navigator;
  const attrs = [];
  if (typeof screen !== "undefined") {
    attrs.push({ key: "device.screen.width", value: { stringValue: String(screen.width) } });
    attrs.push({ key: "device.screen.height", value: { stringValue: String(screen.height) } });
    attrs.push({ key: "device.screen.color_depth", value: { stringValue: String(screen.colorDepth) } });
  }
  if (window.devicePixelRatio) {
    attrs.push({ key: "device.pixel_ratio", value: { stringValue: String(window.devicePixelRatio) } });
  }
  if (nav.hardwareConcurrency) {
    attrs.push({ key: "device.cpu_cores", value: { stringValue: String(nav.hardwareConcurrency) } });
  }
  if (nav.deviceMemory) {
    attrs.push({ key: "device.memory_gb", value: { stringValue: String(nav.deviceMemory) } });
  }
  if (nav.connection) {
    if (nav.connection.effectiveType) {
      attrs.push({ key: "network.effective_type", value: { stringValue: nav.connection.effectiveType } });
    }
    if (nav.connection.downlink != null) {
      attrs.push({ key: "network.downlink_mbps", value: { stringValue: String(nav.connection.downlink) } });
    }
    if (nav.connection.rtt != null) {
      attrs.push({ key: "network.rtt_ms", value: { stringValue: String(nav.connection.rtt) } });
    }
    if (nav.connection.saveData != null) {
      attrs.push({ key: "network.save_data", value: { stringValue: String(nav.connection.saveData) } });
    }
  }
  attrs.push({ key: "network.online", value: { stringValue: String(nav.onLine) } });
  if (nav.platform) {
    attrs.push({ key: "device.platform", value: { stringValue: nav.platform } });
  }
  attrs.push({ key: "device.touch", value: { stringValue: String("ontouchstart" in window || nav.maxTouchPoints > 0) } });
  return attrs;
}

// src/web_vitals.ts
var installed2 = false;
var vitals = {};
function getWebVitals() {
  return { ...vitals };
}
function installWebVitals() {
  if (installed2) return;
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  installed2 = true;
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        vitals.LCP = last.startTime;
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
  }
  try {
    const fcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          vitals.FCP = entry.startTime;
        }
      }
    });
    fcpObserver.observe({ type: "paint", buffered: true });
  } catch {
  }
  try {
    let clsValue = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
          vitals.CLS = clsValue;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
  }
  try {
    let maxINP = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration;
        if (duration > maxINP) {
          maxINP = duration;
          vitals.INP = duration;
        }
      }
    }).observe({ type: "event", buffered: true });
  } catch {
  }
  try {
    const navEntries = performance.getEntriesByType("navigation");
    if (navEntries.length > 0) {
      vitals.TTFB = navEntries[0].responseStart;
    }
  } catch {
  }
}
function uninstallWebVitals() {
  if (!installed2) return;
  installed2 = false;
}

// src/error_capture.ts
var SENSITIVE_COOKIE_PATTERNS = [
  /_session/i,
  /csrf/i,
  /token/i,
  /auth/i,
  /secret/i,
  /key/i
];
var SENSITIVE_PARAM_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api_key/i,
  /credit_card/i,
  /auth/i
];
function parseCookies(cookieString) {
  const cookies = {};
  if (!cookieString) return cookies;
  for (const pair of cookieString.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}
var installed3 = false;
var onErrorHandler = null;
var onUnhandledRejectionHandler = null;
function captureException(error, extra) {
  const config = getConfig();
  if (!config.enabled) return;
  const err = typeof error === "string" ? new Error(error) : error;
  const now = String(Date.now() * 1e6);
  const attributes = [
    { key: "exception.type", value: { stringValue: err.name || "Error" } },
    { key: "exception.message", value: { stringValue: err.message } },
    { key: "exception.stacktrace", value: { stringValue: truncateStack(err.stack || "", config.maxStackFrames) } },
    { key: "breadcrumbs", value: { stringValue: JSON.stringify(getBreadcrumbs()) } },
    { key: "log.source", value: { stringValue: "browser" } }
  ];
  const sid = getSessionId();
  if (sid) {
    attributes.push({ key: "session.id", value: { stringValue: sid } });
  }
  const sessionStart = getSessionStartedAt();
  if (sessionStart) {
    attributes.push({ key: "session.started_at", value: { stringValue: sessionStart } });
  }
  if (typeof window !== "undefined") {
    attributes.push({ key: "browser.url", value: { stringValue: window.location.href } });
    attributes.push({ key: "browser.user_agent", value: { stringValue: navigator.userAgent } });
    attributes.push({ key: "browser.language", value: { stringValue: navigator.language } });
    attributes.push({ key: "browser.viewport", value: { stringValue: `${window.innerWidth}x${window.innerHeight}` } });
    const ua = parseUserAgent(navigator.userAgent);
    attributes.push({ key: "browser.name", value: { stringValue: ua.browser.name } });
    attributes.push({ key: "browser.version", value: { stringValue: ua.browser.version } });
    attributes.push({ key: "os.name", value: { stringValue: ua.os.name } });
    attributes.push({ key: "os.version", value: { stringValue: ua.os.version } });
    attributes.push({ key: "device.type", value: { stringValue: ua.device.type } });
    attributes.push(...getDeviceContextAttributes());
    const vitals2 = getWebVitals();
    for (const [name, value] of Object.entries(vitals2)) {
      attributes.push({ key: `web_vital.${name}`, value: { stringValue: String(Math.round(value * 100) / 100) } });
    }
    const cookies = parseCookies(document.cookie);
    for (const [name, value] of Object.entries(cookies)) {
      if (!SENSITIVE_COOKIE_PATTERNS.some((p) => p.test(name))) {
        attributes.push({ key: `http.request.cookie.${name}`, value: { stringValue: value } });
      }
    }
    const params = new URLSearchParams(window.location.search);
    params.forEach((value, name) => {
      if (!SENSITIVE_PARAM_PATTERNS.some((p) => p.test(name))) {
        attributes.push({ key: `http.request.param.${name}`, value: { stringValue: value } });
      }
    });
    try {
      const storageKeys = Object.keys(localStorage);
      if (storageKeys.length > 0) {
        attributes.push({ key: "browser.local_storage_keys", value: { stringValue: storageKeys.join(", ") } });
      }
    } catch {
    }
  }
  const allTags = { ...config.tags, ...extra?.tags };
  for (const [k, v] of Object.entries(allTags)) {
    attributes.push({ key: `tag.${k}`, value: { stringValue: v } });
  }
  if (extra?.user?.id) {
    attributes.push({ key: "user.id", value: { stringValue: extra.user.id } });
  }
  if (extra?.user?.email) {
    attributes.push({ key: "user.email", value: { stringValue: extra.user.email } });
  }
  if (extra?.extra) {
    for (const [k, v] of Object.entries(extra.extra)) {
      attributes.push({ key: `extra.${k}`, value: { stringValue: v } });
    }
  }
  let logRecord = {
    timeUnixNano: now,
    observedTimeUnixNano: now,
    severityNumber: 17,
    severityText: "ERROR",
    body: { stringValue: `${err.name}: ${err.message}` },
    attributes
  };
  if (config.beforeSend) {
    const result = config.beforeSend(logRecord);
    if (result === false) return;
    logRecord = result;
  }
  enqueue(logRecord);
  clearBreadcrumbs();
}
function truncateStack(stack, maxFrames) {
  const lines = stack.split("\n");
  return lines.slice(0, maxFrames + 1).join("\n");
}
function installGlobalHandlers() {
  if (installed3 || typeof window === "undefined") return;
  installed3 = true;
  onErrorHandler = (message, source, lineno, colno, error) => {
    const err = error || new Error(String(message));
    captureException(err, {
      extra: {
        ...source ? { source } : {},
        ...lineno != null ? { lineno: String(lineno) } : {},
        ...colno != null ? { colno: String(colno) } : {}
      }
    });
  };
  window.onerror = onErrorHandler;
  onUnhandledRejectionHandler = (event) => {
    const reason = event.reason;
    const err = reason instanceof Error ? reason : new Error(String(reason));
    captureException(err, { tags: { mechanism: "unhandledrejection" } });
  };
  window.addEventListener("unhandledrejection", onUnhandledRejectionHandler);
}
function uninstallGlobalHandlers() {
  if (!installed3 || typeof window === "undefined") return;
  installed3 = false;
  window.onerror = null;
  if (onUnhandledRejectionHandler) {
    window.removeEventListener("unhandledrejection", onUnhandledRejectionHandler);
  }
}

// src/resource_errors.ts
var installed4 = false;
var handler = null;
function installResourceErrorCapture() {
  if (installed4 || typeof window === "undefined") return;
  installed4 = true;
  handler = (event) => {
    const target = event.target;
    if (!target) return;
    const tagName = target.tagName?.toLowerCase();
    if (!tagName || !["script", "img", "link", "video", "audio", "source", "iframe"].includes(tagName)) return;
    const src = target.src || target.href || "";
    if (!src) return;
    const error = new Error(`Failed to load ${tagName}: ${src}`);
    error.name = "ResourceLoadError";
    captureException(error, {
      tags: {
        mechanism: "resource_error",
        resource_type: tagName
      },
      extra: {
        resource_url: src,
        element: formatElement(target)
      }
    });
  };
  window.addEventListener("error", handler, { capture: true });
}
function formatElement(el) {
  const tag = el.tagName?.toLowerCase() || "";
  const id = el.id ? `#${el.id}` : "";
  const cls = el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
  return `<${tag}${id}${cls}>`;
}
function uninstallResourceErrorCapture() {
  if (!installed4 || typeof window === "undefined") return;
  installed4 = false;
  if (handler) {
    window.removeEventListener("error", handler, { capture: true });
    handler = null;
  }
}

// src/index.ts
function init(options) {
  configure(options);
  const config = getConfig();
  if (!config.enabled) return;
  initSession();
  installBreadcrumbs();
  installGlobalHandlers();
  installResourceErrorCapture();
  installWebVitals();
  startFlushTimer();
}
function destroy() {
  flush();
  uninstallBreadcrumbs();
  uninstallGlobalHandlers();
  uninstallResourceErrorCapture();
  uninstallWebVitals();
  stopFlushTimer();
}
export {
  addBreadcrumb,
  captureException,
  destroy,
  flush,
  getConfig,
  init
};
