import { getConfig } from './configuration';
import { enqueue } from './transport';
import type { OtlpLogRecord, OtlpAttribute } from './configuration';

let installed = false;
let observer: PerformanceObserver | null = null;

// Store latest vitals so they can be attached to errors
const vitals: Record<string, number> = {};

export function getWebVitals(): Record<string, number> {
  return { ...vitals };
}

function emitVitalLog(name: string, value: number, rating: string): void {
  const config = getConfig();
  if (!config.enabled) return;

  const now = String(Date.now() * 1_000_000);

  const attributes: OtlpAttribute[] = [
    { key: 'web_vital.name', value: { stringValue: name } },
    { key: 'web_vital.value', value: { stringValue: String(Math.round(value * 100) / 100) } },
    { key: 'web_vital.rating', value: { stringValue: rating } },
    { key: 'log.source', value: { stringValue: 'browser.web_vitals' } },
  ];

  if (typeof window !== 'undefined') {
    attributes.push({ key: 'browser.url', value: { stringValue: window.location.href } });
  }

  const logRecord: OtlpLogRecord = {
    timeUnixNano: now,
    observedTimeUnixNano: now,
    severityNumber: rating === 'good' ? 9 : rating === 'needs-improvement' ? 13 : 17, // INFO / WARN / ERROR
    severityText: rating === 'good' ? 'INFO' : rating === 'needs-improvement' ? 'WARN' : 'ERROR',
    body: { stringValue: `Web Vital: ${name} = ${Math.round(value * 100) / 100} (${rating})` },
    attributes,
  };

  enqueue(logRecord);
}

// Thresholds based on Google's Core Web Vitals guidelines
function rateVital(name: string, value: number): string {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    FCP: [1800, 3000],
    CLS: [0.1, 0.25],
    INP: [200, 500],
    TTFB: [800, 1800],
    FID: [100, 300],
  };

  const [good, poor] = thresholds[name] || [Infinity, Infinity];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

export function installWebVitals(): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  installed = true;

  // LCP — Largest Contentful Paint
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
      if (last) {
        vitals.LCP = last.startTime;
        const rating = rateVital('LCP', last.startTime);
        emitVitalLog('LCP', last.startTime, rating);
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* not supported */ }

  // FCP — First Contentful Paint
  try {
    const fcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          vitals.FCP = entry.startTime;
          const rating = rateVital('FCP', entry.startTime);
          emitVitalLog('FCP', entry.startTime, rating);
        }
      }
    });
    fcpObserver.observe({ type: 'paint', buffered: true });
  } catch { /* not supported */ }

  // CLS — Cumulative Layout Shift
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) {
          clsValue += (entry as PerformanceEntry & { value: number }).value;
          vitals.CLS = clsValue;
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });

    // Report CLS on page hide
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && vitals.CLS != null) {
          emitVitalLog('CLS', vitals.CLS, rateVital('CLS', vitals.CLS));
        }
      });
    }
  } catch { /* not supported */ }

  // INP — Interaction to Next Paint (replaces FID)
  try {
    let maxINP = 0;
    const inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration;
        if (duration > maxINP) {
          maxINP = duration;
          vitals.INP = duration;
        }
      }
    });
    inpObserver.observe({ type: 'event', buffered: true });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && vitals.INP != null) {
          emitVitalLog('INP', vitals.INP, rateVital('INP', vitals.INP));
        }
      });
    }
  } catch { /* not supported */ }

  // TTFB — Time to First Byte
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      const ttfb = navEntries[0].responseStart;
      vitals.TTFB = ttfb;
      emitVitalLog('TTFB', ttfb, rateVital('TTFB', ttfb));
    }
  } catch { /* not supported */ }
}

export function uninstallWebVitals(): void {
  if (!installed) return;
  installed = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}
