import type { ServerContext } from '@modelcontextprotocol/server';

/** Segunda rodada MRTR: já existe um `requestState` assinado nesta chamada. */
export function hasConfirmationState(ctx: ServerContext): boolean {
  return ctx.mcpReq.requestState() !== undefined;
}

/**
 * Prepara texto vindo da D4Sign para exibição.
 *
 * Remove caracteres de controle e os delimitadores usados pelo servidor para
 * marcar dados upstream, de modo que um nome de documento não possa fingir ser
 * instrução nem fechar a citação em que está inserido.
 */
export function safeDisplay(value: string | null, fallback: string): string {
  if (value === null || value.trim().length === 0) return fallback;
  let sanitized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += codePoint <= 31 || codePoint === 127 || character === '«' || character === '»'
      ? ' '
      : character;
  }
  return sanitized.trim().slice(0, 512);
}
