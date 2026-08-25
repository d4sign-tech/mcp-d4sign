import { describe, expect, it } from 'vitest';

import {
  DocumentCancelInputSchema,
  DocumentSendForSignatureInputSchema,
  DocumentSignerMutationInputSchema,
  UserBlockInputSchema,
} from '../../src/tools/schemas.js';

const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';

describe('schemas de entrada da Sprint 5', () => {
  it('aplica padrões explícitos e normaliza e-mails', () => {
    expect(DocumentSendForSignatureInputSchema.parse({ documentUuid })).toEqual({
      documentUuid,
      notifySigners: true,
      followSigningOrder: false,
    });
    expect(
      DocumentSignerMutationInputSchema.parse({
        documentUuid,
        email: 'PESSOA@example.com',
        keySigner: ' chave-1 ',
      }),
    ).toMatchObject({ email: 'pessoa@example.com', keySigner: 'chave-1' });
    expect(UserBlockInputSchema.parse({ email: 'USER@example.com' })).toEqual({
      email: 'user@example.com',
    });
  });

  it('rejeita datas impossíveis, controles, campos extras e identificadores incompletos', () => {
    expect(
      DocumentSendForSignatureInputSchema.safeParse({ documentUuid, signLimitDate: '31-02-27' }).success,
    ).toBe(false);
    expect(DocumentCancelInputSchema.safeParse({ documentUuid, comment: 'motivo\nnão permitido' }).success).toBe(false);
    expect(DocumentSignerMutationInputSchema.safeParse({ documentUuid, email: 'a@example.com' }).success).toBe(false);
    expect(UserBlockInputSchema.safeParse({ email: 'a@example.com', tokenAPI: 'proibido' }).success).toBe(false);
  });
});
