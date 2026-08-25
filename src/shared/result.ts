import type { CallToolResult } from '@modelcontextprotocol/server';
import { ZodError } from 'zod/v4';

import {
  AuthorizationError,
  ConfirmationError,
  D4SignApiError,
  D4SignResponseError,
  QuotaExceededError,
  ResponseTooLargeError,
  UploadError,
  UploadScanPendingError,
} from '../d4sign/errors.js';
import { CredentialNotConfiguredError } from '../auth/credential-provider.js';

type ErrorCategory =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'upstream_transient'
  | 'upstream_contract'
  | 'confirmation'
  | 'unknown';

interface SemanticToolError {
  version: '1';
  category: ErrorCategory;
  code: string;
  retryable: boolean;
  message: string;
  suggestedAction: 'fix_input' | 'authenticate' | 'request_permission' | 'wait_and_retry' | 'confirm' | 'contact_support';
  cooldownSeconds?: number;
  upstreamRequestId?: string;
  fieldErrors?: { path: string; message: string }[];
}

function safeMessage(error: unknown): string {
  if (error instanceof AuthorizationError) return error.message;
  if (error instanceof ConfirmationError) return error.message;
  if (error instanceof QuotaExceededError) return error.message;
  if (error instanceof D4SignApiError) return error.message;
  if (error instanceof D4SignResponseError) return error.message;
  if (error instanceof ResponseTooLargeError) return error.message;
  if (error instanceof UploadError) return error.message;
  if (error instanceof UploadScanPendingError) return error.message;
  if (error instanceof CredentialNotConfiguredError) return error.message;
  return 'Não foi possível concluir a operação D4Sign.';
}

function normalizeError(error: unknown): SemanticToolError {
  const base = { version: '1' as const, message: safeMessage(error) };
  if (error instanceof ZodError) {
    return {
      ...base,
      category: 'validation',
      code: 'INVALID_INPUT',
      retryable: false,
      suggestedAction: 'fix_input',
      fieldErrors: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    };
  }
  if (error instanceof CredentialNotConfiguredError) {
    return { ...base, category: 'authentication', code: 'D4SIGN_CREDENTIALS_NOT_CONFIGURED', retryable: false, suggestedAction: 'authenticate' };
  }
  if (error instanceof AuthorizationError) {
    return { ...base, category: 'authorization', code: 'INSUFFICIENT_SCOPE', retryable: false, suggestedAction: 'request_permission' };
  }
  if (error instanceof ConfirmationError) {
    return { ...base, category: 'confirmation', code: 'CONFIRMATION_REQUIRED_OR_INVALID', retryable: false, suggestedAction: 'confirm' };
  }
  if (error instanceof QuotaExceededError) {
    return {
      ...base,
      category: 'rate_limit',
      code: 'D4SIGN_LOCAL_QUOTA_EXCEEDED',
      retryable: true,
      suggestedAction: 'wait_and_retry',
      cooldownSeconds: Math.max(0, Math.ceil((error.retryAt.getTime() - Date.now()) / 1_000)),
    };
  }
  if (error instanceof UploadScanPendingError) {
    return {
      ...base,
      category: 'upstream_transient',
      code: 'UPLOAD_SCAN_PENDING',
      retryable: true,
      suggestedAction: 'wait_and_retry',
      cooldownSeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof D4SignApiError) {
    const category: ErrorCategory = error.status === 404
      ? 'not_found'
      : error.status === 409
        ? 'conflict'
        : error.status === 401
          ? 'authentication'
          : error.status === 403
            ? 'authorization'
            : error.status === 429
              ? 'rate_limit'
              : error.retryable
                ? 'upstream_transient'
                : 'validation';
    return {
      ...base,
      category,
      code: error.code,
      retryable: error.retryable || error.status === 429,
      suggestedAction: error.retryable || error.status === 429
        ? 'wait_and_retry'
        : error.status === 401
          ? 'authenticate'
          : error.status === 403
            ? 'request_permission'
            : 'fix_input',
      ...(error.retryAfterSeconds === undefined ? {} : { cooldownSeconds: error.retryAfterSeconds }),
      ...(error.requestId === undefined ? {} : { upstreamRequestId: error.requestId }),
    };
  }
  if (error instanceof D4SignResponseError || error instanceof ResponseTooLargeError) {
    return { ...base, category: 'upstream_contract', code: error.name, retryable: false, suggestedAction: 'contact_support' };
  }
  if (error instanceof UploadError) {
    return { ...base, category: 'validation', code: 'INVALID_UPLOAD', retryable: false, suggestedAction: 'fix_input' };
  }
  return { ...base, category: 'unknown', code: 'INTERNAL_ERROR', retryable: false, suggestedAction: 'contact_support' };
}

export function toToolError(error: unknown): CallToolResult {
  const normalized = normalizeError(error);
  return {
    content: [{ type: 'text', text: JSON.stringify(normalized) }],
    isError: true,
  };
}
