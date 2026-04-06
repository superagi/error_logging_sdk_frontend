let sessionId: string | null = null;
let sessionStartedAt: string | null = null;

function generateId(): string {
  // Crypto-safe random ID if available, fallback to Math.random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function initSession(): void {
  // Try to restore session from sessionStorage (persists across page reloads within tab)
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('_otel_error_session');
      if (stored) {
        const parsed = JSON.parse(stored);
        sessionId = parsed.id;
        sessionStartedAt = parsed.startedAt;
        return;
      }
    } catch { /* ignore */ }
  }

  sessionId = generateId();
  sessionStartedAt = new Date().toISOString();

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem('_otel_error_session', JSON.stringify({
        id: sessionId,
        startedAt: sessionStartedAt,
      }));
    } catch { /* storage full or blocked */ }
  }
}

export function getSessionId(): string | null {
  return sessionId;
}

export function getSessionStartedAt(): string | null {
  return sessionStartedAt;
}
