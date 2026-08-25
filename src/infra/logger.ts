import pino, { type Logger } from 'pino';

import { currentRequestId } from './request-context.js';
import { sanitizeTelemetryValue } from './telemetry-sanitizer.js';

export type AppLogger = Logger;

export function createLogger(level: string): AppLogger {
  return pino(
    {
      level,
      redact: {
        paths: [
          'token',
          'accessToken',
          'refreshToken',
          'password',
          'secret',
          'apiKey',
          'tokenAPI',
          'tokenApi',
          'cryptKey',
          'authorization',
          'req.headers.authorization',
          '*.tokenAPI',
          '*.tokenApi',
          '*.cryptKey',
          '*.token',
          '*.accessToken',
          '*.refreshToken',
          '*.password',
          '*.secret',
          '*.apiKey',
          'req.body',
          'request.body',
          'base64',
          '*.base64',
          'bytes',
          '*.bytes',
        ],
        censor: '[REDACTED]',
      },
      mixin() {
        const requestId = currentRequestId();
        return requestId === undefined ? {} : { requestId };
      },
      serializers: {
        err(error: unknown) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          return sanitizeTelemetryValue(pino.stdSerializers.err(normalized));
        },
      },
    },
    pino.destination({ fd: 2, sync: false }),
  );
}
