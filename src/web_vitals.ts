let installed = false;

// Store latest vitals so they can be attached to errors
const vitals: Record<string, number> = {};

export function getWebVitals(): Record<string, number> {
  return { ...vitals };
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
        }
      }
    });
    fcpObserver.observe({ type: 'paint', buffered: true });
  } catch { /* not supported */ }

  // CLS — Cumulative Layout Shift
  try {
    let clsValue = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as PerformanceEntry & { hadRecentInput: boolean }).hadRecentInput) {
          clsValue += (entry as PerformanceEntry & { value: number }).value;
          vitals.CLS = clsValue;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* not supported */ }

  // INP — Interaction to Next Paint
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
    }).observe({ type: 'event', buffered: true });
  } catch { /* not supported */ }

  // TTFB — Time to First Byte
  try {
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
      vitals.TTFB = navEntries[0].responseStart;
    }
  } catch { /* not supported */ }
}

export function uninstallWebVitals(): void {
  if (!installed) return;
  installed = false;
}
