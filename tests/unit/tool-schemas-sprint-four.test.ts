import { describe, expect, it } from 'vitest';

import {
  DocumentObserverAddInputSchema,
  DocumentTagAddInputSchema,
  VaultFolderCreateInputSchema,
} from '../../src/tools/schemas.js';

const vaultUuid = '06b3ddb1-abc9-4ab8-b944-0d7c940486af';
const documentUuid = '9f08bf18-bf4b-410f-9701-c286e5b1cad1';

describe('schemas de entrada da Sprint 4', () => {
  it('normaliza nomes e usa perfil de observador com menor privilégio por padrão', () => {
    expect(VaultFolderCreateInputSchema.parse({ vaultUuid, folderName: '  Jurídico  ' })).toMatchObject({
      vaultUuid,
      folderName: 'Jurídico',
    });
    expect(
      DocumentObserverAddInputSchema.parse({ documentUuid, email: 'pessoa@example.com' }),
    ).toMatchObject({ permission: '1' });
  });

  it('rejeita tag múltipla, caracteres de controle e campos extras', () => {
    expect(DocumentTagAddInputSchema.safeParse({ documentUuid, tag: 'uma, duas' }).success).toBe(false);
    expect(VaultFolderCreateInputSchema.safeParse({ vaultUuid, folderName: 'pasta\nnova' }).success).toBe(false);
    expect(
      DocumentObserverAddInputSchema.safeParse({
        documentUuid,
        email: 'pessoa@example.com',
        permission: '1',
        tokenAPI: 'não permitido',
      }).success,
    ).toBe(false);
  });
});
