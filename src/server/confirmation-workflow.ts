import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  acceptedContent,
  createRequestStateCodec,
  inputRequired,
  type InputRequiredResult,
  type RequestStateCodec,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import { LOCAL_STDIO_CONTEXT, authContextFromServerContext } from '../auth/authorize.js';
import type { McpTransport } from '../config/types.js';
import { ConfirmationError } from '../d4sign/errors.js';
import { InMemoryReplayStore, type ReplayStore } from '../infra/replay-store.js';

export const SENSITIVE_ACTIONS = [
  'd4sign_document_send_for_signature',
  'd4sign_document_cancel',
  'd4sign_document_signature_link_resend',
  'd4sign_document_signer_remove',
  'd4sign_user_block',
  'd4sign_user_unblock',
  'd4sign_document_tags_remove_all',
  'd4sign_document_observers_remove_all',
] as const;

export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];

const ConfirmationResponseSchema = z
  .object({
    confirm: z
      .boolean()
      .describe('Marque como verdadeiro somente se você confirma exatamente a operação descrita.'),
  })
  .strict();

const ConfirmationRequestSchema = {
  type: 'object' as const,
  properties: {
    confirm: {
      type: 'boolean' as const,
      title: 'Confirmar operação',
      description: 'Marque somente se deseja executar exatamente a operação descrita.',
    },
  },
  required: ['confirm'],
};

const ConfirmationStateSchema = z
  .object({
    version: z.literal(1),
    flowId: z.uuid(),
    action: z.enum(SENSITIVE_ACTIONS),
    argumentsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    subjectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

type ConfirmationState = z.infer<typeof ConfirmationStateSchema>;

export interface ConfirmationWorkflowOptions {
  key: Uint8Array | string;
  transport?: McpTransport;
  ttlSeconds?: number;
  now?: () => number;
  createFlowId?: () => string;
  replayStore?: ReplayStore;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
  return `{${entries.join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function digestsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Vincula o `requestState` ao método MCP e à identidade autenticada.
 *
 * No transporte HTTP a ausência de identidade é falha fechada: sem isso, todas
 * as confirmações compartilhariam um binding constante e uma confirmação emitida
 * para um principal poderia ser apresentada por outro.
 */
function createRequestBinding(transport: McpTransport): (ctx: ServerContext) => string {
  return (ctx) => {
    const context = authContextFromServerContext(ctx);
    if (context === undefined) {
      if (transport === 'http') {
        throw new ConfirmationError('A confirmação exige um contexto autenticado.');
      }
      return `${ctx.mcpReq.method}\0${LOCAL_STDIO_CONTEXT.principalId}\0${LOCAL_STDIO_CONTEXT.tenantId}`;
    }
    return `${ctx.mcpReq.method}\0${context.principalId}\0${context.tenantId}`;
  };
}

export class ConfirmationWorkflow {
  private readonly codec: RequestStateCodec<ConfirmationState>;
  private readonly replayStore: ReplayStore;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly createFlowId: () => string;

  constructor(options: ConfirmationWorkflowOptions) {
    const ttlSeconds = options.ttlSeconds ?? 300;
    this.ttlMs = ttlSeconds * 1_000;
    this.now = options.now ?? Date.now;
    this.createFlowId = options.createFlowId ?? randomUUID;
    this.replayStore = options.replayStore ?? new InMemoryReplayStore(this.now);
    this.codec = createRequestStateCodec<ConfirmationState>({
      key: options.key,
      ttlSeconds,
      bind: createRequestBinding(options.transport ?? 'stdio'),
    });
  }

  readonly verifyRequestState = (state: string, ctx: ServerContext): Promise<ConfirmationState> =>
    this.codec.verify(state, ctx);

  async request(
    action: SensitiveAction,
    args: unknown,
    subject: unknown,
    message: string,
    ctx: ServerContext,
  ): Promise<InputRequiredResult> {
    const state: ConfirmationState = {
      version: 1,
      flowId: this.createFlowId(),
      action,
      argumentsDigest: digest(args),
      subjectDigest: digest(subject),
    };
    return inputRequired({
      inputRequests: {
        confirmation: inputRequired.elicit({
          mode: 'form',
          message,
          requestedSchema: ConfirmationRequestSchema,
        }),
      },
      requestState: await this.codec.mint(state, ctx),
    });
  }

  async accept(action: SensitiveAction, args: unknown, ctx: ServerContext): Promise<string> {
    const parsed = ConfirmationStateSchema.safeParse(ctx.mcpReq.requestState());
    if (!parsed.success) throw new ConfirmationError('A confirmação está ausente ou é inválida.');

    if (!(await this.replayStore.consume(parsed.data.flowId, this.ttlMs))) {
      throw new ConfirmationError('Esta confirmação já foi utilizada.');
    }

    if (
      parsed.data.action !== action
      || !digestsEqual(parsed.data.argumentsDigest, digest(args))
    ) {
      throw new ConfirmationError('A confirmação não corresponde exatamente à operação solicitada.');
    }

    const response = acceptedContent(
      ctx.mcpReq.inputResponses,
      'confirmation',
      ConfirmationResponseSchema,
    );
    if (response?.confirm !== true) {
      throw new ConfirmationError('A operação não foi confirmada e nenhuma alteração foi realizada.');
    }

    return parsed.data.subjectDigest;
  }

  assertSubjectUnchanged(expectedDigest: string, subject: unknown): void {
    if (!digestsEqual(expectedDigest, digest(subject))) {
      throw new ConfirmationError(
        'O estado do alvo mudou após a confirmação. Revise os dados e execute a operação novamente.',
      );
    }
  }
}
