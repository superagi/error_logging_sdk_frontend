export interface ParsedUserAgent {
  browser: { name: string; version: string };
  os: { name: string; version: string };
  device: { type: 'desktop' | 'mobile' | 'tablet' | 'unknown' };
}

export function parseUserAgent(ua: string): ParsedUserAgent {
  return {
    browser: parseBrowser(ua),
    os: parseOS(ua),
    device: { type: parseDeviceType(ua) },
  };
}

function parseBrowser(ua: string): { name: string; version: string } {
  const tests: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/(\S+)/, 'Edge'],
    [/OPR\/(\S+)/, 'Opera'],
    [/SamsungBrowser\/(\S+)/, 'Samsung Internet'],
    [/UCBrowser\/(\S+)/, 'UC Browser'],
    [/Chrome\/(\S+)/, 'Chrome'],
    [/Firefox\/(\S+)/, 'Firefox'],
    [/Version\/(\S+).*Safari/, 'Safari'],
    [/MSIE\s(\S+)/, 'IE'],
    [/Trident.*rv:(\S+)/, 'IE'],
  ];

  for (const [re, name] of tests) {
    const match = ua.match(re);
    if (match) return { name, version: match[1] || 'unknown' };
  }

  return { name: 'unknown', version: 'unknown' };
}

function parseOS(ua: string): { name: string; version: string } {
  const tests: [RegExp, string, number?][] = [
    [/Windows NT (\S+)/, 'Windows'],
    [/Mac OS X ([_\d]+)/, 'macOS'],
    [/iPhone OS ([_\d]+)/, 'iOS'],
    [/iPad.*OS ([_\d]+)/, 'iPadOS'],
    [/Android (\S+)/, 'Android'],
    [/CrOS [^\s]+ ([\d.]+)/, 'Chrome OS'],
    [/Linux/, 'Linux'],
  ];

  for (const [re, name] of tests) {
    const match = ua.match(re);
    if (match) {
      const version = (match[1] || 'unknown').replace(/_/g, '.');
      return { name, version };
    }
  }

  return { name: 'unknown', version: 'unknown' };
}

function parseDeviceType(ua: string): 'desktop' | 'mobile' | 'tablet' | 'unknown' {
  if (/iPad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/Mobile|Android.*Chrome\/[.0-9]* (?!.*Safari)|iPhone|iPod|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'unknown';
}
