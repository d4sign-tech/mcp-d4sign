import { createHash, randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { AuthContext } from '../auth/auth-context.js';
import { UploadError, UploadScanPendingError } from '../d4sign/errors.js';

export interface StagedUpload {
  handle: string;
  principalId: string;
  tenantId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
  expiresAt: Date;
}

export interface UploadReceipt {
  uploadHandle: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: string;
}

export interface UploadStore {
  put(
    auth: AuthContext,
    file: { fileName: string; mimeType: string; bytes: Uint8Array },
  ): Promise<UploadReceipt>;
  get(auth: AuthContext, handle: string): Promise<StagedUpload>;
  delete(auth: AuthContext, handle: string): Promise<void>;
}

interface StoredUpload extends StagedUpload {
  expiresAtMs: number;
}

export class InMemoryUploadStore implements UploadStore {
  private readonly uploads = new Map<string, StoredUpload>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100,
    private readonly now: () => number = Date.now,
    private readonly maxEntriesPerPrincipal = 10,
  ) {}

  put(
    auth: AuthContext,
    file: { fileName: string; mimeType: string; bytes: Uint8Array },
  ): Promise<UploadReceipt> {
    return Promise.resolve().then(() => {
      this.sweep();
      // Teto por principal antes do teto global, para que um principal não
      // esgote o armazenamento temporário dos demais.
      const ownedByPrincipal = [...this.uploads.values()].filter(
        (upload) => upload.principalId === auth.principalId && upload.tenantId === auth.tenantId,
      ).length;
      if (ownedByPrincipal >= this.maxEntriesPerPrincipal) {
        throw new UploadError('Há uploads temporários pendentes demais para este principal. Consuma ou aguarde a expiração.');
      }
      if (this.uploads.size >= this.maxEntries) {
        throw new UploadError('O armazenamento temporário de uploads está cheio. Tente novamente mais tarde.');
      }

      const handle = randomUUID();
      const expiresAtMs = this.now() + this.ttlMs;
      const sha256 = createHash('sha256').update(file.bytes).digest('hex');
      const stored: StoredUpload = {
        handle,
        principalId: auth.principalId,
        tenantId: auth.tenantId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.byteLength,
        sha256,
        bytes: Uint8Array.from(file.bytes),
        expiresAt: new Date(expiresAtMs),
        expiresAtMs,
      };
      this.uploads.set(handle, stored);
      return {
        uploadHandle: handle,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        expiresAt: stored.expiresAt.toISOString(),
      };
    });
  }

  get(auth: AuthContext, handle: string): Promise<StagedUpload> {
    return Promise.resolve().then(() => {
      this.sweep();
      const upload = this.uploads.get(handle);
      if (
        upload?.principalId !== auth.principalId
        || upload.tenantId !== auth.tenantId
      ) {
        throw new UploadError('O uploadHandle é inválido, expirou ou pertence a outro principal.');
      }
      return {
        ...upload,
        bytes: Uint8Array.from(upload.bytes),
      };
    });
  }

  delete(auth: AuthContext, handle: string): Promise<void> {
    return Promise.resolve().then(() => {
      const upload = this.uploads.get(handle);
      if (
        upload?.principalId === auth.principalId
        && upload.tenantId === auth.tenantId
      ) {
        upload.bytes.fill(0);
        this.uploads.delete(handle);
      }
    });
  }

  private sweep(): void {
    const now = this.now();
    for (const [handle, upload] of this.uploads) {
      if (upload.expiresAtMs <= now) {
        upload.bytes.fill(0);
        this.uploads.delete(handle);
      }
    }
  }
}

function identityHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeMetadata(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeMetadata(value: string | undefined): string | undefined {
  return value === undefined ? undefined : Buffer.from(value, 'base64url').toString('utf8');
}

export interface S3ObjectApi {
  ensureBucket(bucket: string): Promise<void>;
  putObject(input: {
    bucket: string;
    key: string;
    bytes: Uint8Array;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<void>;
  headObject(
    bucket: string,
    key: string,
  ): Promise<{ metadata: Record<string, string>; contentLength?: number; versionId?: string }>;
  getObjectTags(bucket: string, key: string): Promise<Record<string, string>>;
  getObjectBytes(bucket: string, key: string): Promise<Uint8Array>;
  deleteObject(bucket: string, key: string, versionId?: string): Promise<void>;
}

export class AwsSdkS3ObjectApi implements S3ObjectApi {
  constructor(private readonly client: S3Client) {}

  async ensureBucket(bucket: string): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
  }

  async putObject(input: {
    bucket: string;
    key: string;
    bytes: Uint8Array;
    contentType: string;
    metadata: Record<string, string>;
  }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.bytes,
      ContentType: input.contentType,
      CacheControl: 'no-store',
      Metadata: input.metadata,
      ServerSideEncryption: 'aws:kms',
      IfNoneMatch: '*',
    }));
  }

  async headObject(
    bucket: string,
    key: string,
  ): Promise<{ metadata: Record<string, string>; contentLength?: number; versionId?: string }> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return {
      metadata: result.Metadata ?? {},
      ...(result.ContentLength === undefined ? {} : { contentLength: result.ContentLength }),
      ...(result.VersionId === undefined ? {} : { versionId: result.VersionId }),
    };
  }

  async getObjectTags(bucket: string, key: string): Promise<Record<string, string>> {
    const result = await this.client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
    return Object.fromEntries((result.TagSet ?? []).flatMap((tag) => tag.Key === undefined || tag.Value === undefined
      ? []
      : [[tag.Key, tag.Value]]));
  }

  async getObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (result.Body === undefined) throw new UploadError('O objeto temporário não possui conteúdo.');
    return result.Body.transformToByteArray();
  }

  async deleteObject(bucket: string, key: string, versionId?: string): Promise<void> {
    // Com versionId, a versão é removida em definitivo em vez de gerar apenas um
    // delete marker deixando o conteúdo recuperável.
    await this.client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(versionId === undefined ? {} : { VersionId: versionId }),
    }));
  }
}

const GUARDDUTY_SCAN_RESULT_TAG = 'GuardDutyMalwareScanStatus';
const GUARDDUTY_CLEAN_RESULT = 'NO_THREATS_FOUND';

function s3StatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined;
  const metadata = error.$metadata;
  if (typeof metadata !== 'object' || metadata === null || !('httpStatusCode' in metadata)) return undefined;
  const status = metadata.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
}

function s3ErrorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : undefined;
}

function isS3NotFound(error: unknown): boolean {
  const name = s3ErrorName(error);
  return name === 'NoSuchKey' || name === 'NotFound' || s3StatusCode(error) === 404;
}

function isS3AccessDenied(error: unknown): boolean {
  const name = s3ErrorName(error);
  return name === 'AccessDenied' || name === 'Forbidden' || s3StatusCode(error) === 403;
}

export class S3UploadStore implements UploadStore {
  constructor(
    private readonly client: S3ObjectApi,
    private readonly bucket: string,
    private readonly prefix: string,
    private readonly ttlMs: number,
    private readonly maxBytes = 20 * 1_024 * 1_024,
    private readonly now: () => number = Date.now,
    private readonly requireCleanScan = false,
  ) {}

  async ensureBucket(): Promise<void> {
    await this.client.ensureBucket(this.bucket);
  }

  async put(
    auth: AuthContext,
    file: { fileName: string; mimeType: string; bytes: Uint8Array },
  ): Promise<UploadReceipt> {
    const handle = randomUUID();
    const key = this.objectKey(handle);
    const expiresAt = new Date(this.now() + this.ttlMs);
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    await this.client.putObject({
      bucket: this.bucket,
      key,
      bytes: file.bytes,
      contentType: file.mimeType,
      metadata: {
        principal: identityHash(auth.principalId),
        tenant: identityHash(auth.tenantId),
        filename: encodeMetadata(file.fileName),
        mimetype: encodeMetadata(file.mimeType),
        sha256,
        expiresat: String(expiresAt.getTime()),
      },
    });
    return {
      uploadHandle: handle,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.bytes.byteLength,
      sha256,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async get(auth: AuthContext, handle: string): Promise<StagedUpload> {
    const key = this.objectKey(handle);
    try {
      // A verificação antimalware vem PRIMEIRO, e por GetObjectTagging.
      // A bucket policy nega `s3:GetObject` de objeto sem a tag limpa, e
      // HeadObject é autorizado como `s3:GetObject`: consultar a tag antes é o
      // que permite devolver "scan pendente" em vez de um AccessDenied opaco.
      if (this.requireCleanScan) {
        const scanResult = (await this.scanResult(key))[GUARDDUTY_SCAN_RESULT_TAG];
        if (scanResult === undefined) throw new UploadScanPendingError();
        if (scanResult !== GUARDDUTY_CLEAN_RESULT) {
          await this.purge(key);
          throw new UploadError('O upload foi rejeitado pela verificação antimalware e precisa ser reenviado.');
        }
      }

      const properties = await this.client.headObject(this.bucket, key);
      const metadata = properties.metadata;
      const expiresAtMs = Number(metadata.expiresat);
      if (
        metadata.principal !== identityHash(auth.principalId)
        || metadata.tenant !== identityHash(auth.tenantId)
        || !Number.isFinite(expiresAtMs)
        || expiresAtMs <= this.now()
      ) {
        if (Number.isFinite(expiresAtMs) && expiresAtMs <= this.now()) {
          await this.purge(key, properties.versionId);
        }
        throw new UploadError('O uploadHandle é inválido, expirou ou pertence a outro principal.');
      }
      if (properties.contentLength === undefined || properties.contentLength > this.maxBytes) {
        await this.purge(key, properties.versionId);
        throw new UploadError('O upload temporário excede o limite de segurança configurado.');
      }
      const fileName = decodeMetadata(metadata.filename);
      const mimeType = decodeMetadata(metadata.mimetype);
      if (fileName === undefined || mimeType === undefined || metadata.sha256 === undefined) {
        throw new UploadError('Os metadados do upload temporário são inválidos.');
      }
      const bytes = await this.client.getObjectBytes(this.bucket, key);
      if (createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
        throw new UploadError('A integridade do upload temporário não pôde ser validada.');
      }
      return {
        handle,
        principalId: auth.principalId,
        tenantId: auth.tenantId,
        fileName,
        mimeType,
        sizeBytes: bytes.byteLength,
        sha256: metadata.sha256,
        bytes,
        expiresAt: new Date(expiresAtMs),
      };
    } catch (error) {
      if (error instanceof UploadError || error instanceof UploadScanPendingError) throw error;
      if (isS3NotFound(error)) {
        throw new UploadError('O uploadHandle é inválido, expirou ou pertence a outro principal.');
      }
      // Rede de segurança: com a exigência de scan ativa, um 403 é indício de
      // objeto ainda sem a tag limpa, e precisa virar erro transitório.
      if (this.requireCleanScan && isS3AccessDenied(error)) throw new UploadScanPendingError();
      throw error;
    }
  }

  async delete(auth: AuthContext, handle: string): Promise<void> {
    try {
      const key = this.objectKey(handle);
      const properties = await this.client.headObject(this.bucket, key);
      if (
        properties.metadata.principal === identityHash(auth.principalId)
        && properties.metadata.tenant === identityHash(auth.tenantId)
      ) {
        await this.purge(key, properties.versionId);
      }
    } catch (error) {
      if (!isS3NotFound(error)) throw error;
    }
  }

  private async scanResult(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.getObjectTags(this.bucket, key);
    } catch (error) {
      if (isS3NotFound(error)) throw error;
      // Sem leitura de tag não há como afirmar que o objeto está limpo.
      if (isS3AccessDenied(error)) throw new UploadScanPendingError();
      throw error;
    }
  }

  private async purge(key: string, versionId?: string): Promise<void> {
    let resolvedVersionId = versionId;
    if (resolvedVersionId === undefined) {
      try {
        resolvedVersionId = (await this.client.headObject(this.bucket, key)).versionId;
      } catch {
        resolvedVersionId = undefined;
      }
    }
    await this.client.deleteObject(this.bucket, key, resolvedVersionId);
  }

  private objectKey(handle: string): string {
    return `${this.prefix}/${handle}`;
  }
}
