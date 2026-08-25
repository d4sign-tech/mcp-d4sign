export class D4SignApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    /** Segundos indicados pelo `Retry-After` upstream, quando presente. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'D4SignApiError';
  }
}

export class D4SignResponseError extends Error {
  constructor(message = 'A D4Sign retornou uma resposta fora do contrato esperado.') {
    super(message);
    this.name = 'D4SignResponseError';
  }
}

export class QuotaExceededError extends Error {
  constructor(readonly retryAt: Date) {
    super(`A cota local de requisições D4Sign foi esgotada. Tente novamente após ${retryAt.toISOString()}.`);
    this.name = 'QuotaExceededError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class ResponseTooLargeError extends Error {
  constructor() {
    super('A resposta D4Sign excedeu o limite de segurança configurado.');
    this.name = 'ResponseTooLargeError';
  }
}

export class ConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmationError';
  }
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

export class UploadScanPendingError extends Error {
  constructor(readonly retryAfterSeconds = 5) {
    super('O upload ainda está em análise antimalware. Aguarde e tente usar o mesmo uploadHandle novamente.');
    this.name = 'UploadScanPendingError';
  }
}
