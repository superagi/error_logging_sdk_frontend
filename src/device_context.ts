import type { OtlpAttribute } from './configuration';

interface NavigatorExtended extends Navigator {
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
}

export function getDeviceContextAttributes(): OtlpAttribute[] {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return [];

  const nav = navigator as NavigatorExtended;
  const attrs: OtlpAttribute[] = [];

  // Screen info
  if (typeof screen !== 'undefined') {
    attrs.push({ key: 'device.screen.width', value: { stringValue: String(screen.width) } });
    attrs.push({ key: 'device.screen.height', value: { stringValue: String(screen.height) } });
    attrs.push({ key: 'device.screen.color_depth', value: { stringValue: String(screen.colorDepth) } });
  }

  // Device pixel ratio
  if (window.devicePixelRatio) {
    attrs.push({ key: 'device.pixel_ratio', value: { stringValue: String(window.devicePixelRatio) } });
  }

  // Hardware concurrency (CPU cores)
  if (nav.hardwareConcurrency) {
    attrs.push({ key: 'device.cpu_cores', value: { stringValue: String(nav.hardwareConcurrency) } });
  }

  // Device memory (approximate RAM in GB)
  if (nav.deviceMemory) {
    attrs.push({ key: 'device.memory_gb', value: { stringValue: String(nav.deviceMemory) } });
  }

  // Network info
  if (nav.connection) {
    if (nav.connection.effectiveType) {
      attrs.push({ key: 'network.effective_type', value: { stringValue: nav.connection.effectiveType } });
    }
    if (nav.connection.downlink != null) {
      attrs.push({ key: 'network.downlink_mbps', value: { stringValue: String(nav.connection.downlink) } });
    }
    if (nav.connection.rtt != null) {
      attrs.push({ key: 'network.rtt_ms', value: { stringValue: String(nav.connection.rtt) } });
    }
    if (nav.connection.saveData != null) {
      attrs.push({ key: 'network.save_data', value: { stringValue: String(nav.connection.saveData) } });
    }
  }

  // Online status
  attrs.push({ key: 'network.online', value: { stringValue: String(nav.onLine) } });

  // Platform
  if (nav.platform) {
    attrs.push({ key: 'device.platform', value: { stringValue: nav.platform } });
  }

  // Touch support
  attrs.push({ key: 'device.touch', value: { stringValue: String('ontouchstart' in window || nav.maxTouchPoints > 0) } });

  return attrs;
}
