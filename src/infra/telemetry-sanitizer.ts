const SENSITIVE_KEY = /(?:authorization|bearer|token(?:api)?|cryptkey|password|secret|api[_-]?key|base64|bytes)/iu;
const REDACTED = '[REDACTED]';

function sanitizeString(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, `Bearer ${REDACTED}`)
    .replace(/([?&](?:tokenAPI|cryptKey)=)[^&\s]+/giu, `$1${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, REDACTED);
}

export function sanitizeTelemetryValue(value: unknown): unknown {
  return sanitize(value, new WeakSet());
}

function sanitize(value: unknown, visited: WeakSet<object>): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (visited.has(value)) return '[Circular]';
  visited.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => sanitize(entry, visited));
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(entry, visited);
    }
    return result;
  } finally {
    visited.delete(value);
  }
}
