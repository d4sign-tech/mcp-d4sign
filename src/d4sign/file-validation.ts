import { basename, extname } from 'node:path';

import { UploadError } from './errors.js';

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/bmp',
] as const;

export type AllowedUploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

const ALLOWED_MIME_SET = new Set<string>(ALLOWED_UPLOAD_MIME_TYPES);
const MIME_EXTENSIONS: Record<AllowedUploadMimeType, readonly string[]> = {
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/bmp': ['.bmp'],
};

export function sanitizeFileName(input: string): string {
  const trimmed = input.trim();
  let hasControls = false;
  for (const character of trimmed) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) {
      hasControls = true;
      break;
    }
  }
  if (
    trimmed.length === 0
    || trimmed.length > 255
    || basename(trimmed) !== trimmed
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || hasControls
  ) {
    throw new UploadError('O nome do arquivo é inválido.');
  }
  return trimmed;
}

export function normalizeUploadMimeType(input: string): AllowedUploadMimeType {
  const mimeType = input.split(';', 1)[0]?.trim().toLocaleLowerCase() ?? '';
  if (!ALLOWED_MIME_SET.has(mimeType)) {
    throw new UploadError('O tipo do arquivo não é permitido para upload na D4Sign.');
  }
  return mimeType as AllowedUploadMimeType;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function containsAscii(bytes: Uint8Array, value: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(value, 'ascii'));
}

function mimeMatchesContent(bytes: Uint8Array, mimeType: AllowedUploadMimeType): boolean {
  switch (mimeType) {
    case 'application/pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/bmp':
      return startsWith(bytes, [0x42, 0x4d]);
    case 'application/msword':
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return startsWith(bytes, [0x50, 0x4b])
        && containsAscii(bytes, '[Content_Types].xml')
        && containsAscii(bytes, 'word/');
  }
}

export function validateUploadFile(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  maxBytes: number;
}): { bytes: Uint8Array; fileName: string; mimeType: AllowedUploadMimeType } {
  if (input.bytes.byteLength === 0) throw new UploadError('O arquivo está vazio.');
  if (input.bytes.byteLength > input.maxBytes) {
    throw new UploadError(`O arquivo excede o limite local de ${input.maxBytes} bytes.`);
  }
  const fileName = sanitizeFileName(input.fileName);
  const mimeType = normalizeUploadMimeType(input.mimeType);
  if (!MIME_EXTENSIONS[mimeType].includes(extname(fileName).toLocaleLowerCase())) {
    throw new UploadError('A extensão do arquivo não corresponde ao MIME informado.');
  }
  if (!mimeMatchesContent(input.bytes, mimeType)) {
    throw new UploadError('O conteúdo do arquivo não corresponde ao MIME informado.');
  }
  return { bytes: input.bytes, fileName, mimeType };
}

export function decodeBase64File(input: string, maxBytes: number): Uint8Array {
  if (input.length === 0 || input.startsWith('data:') || !/^[A-Za-z0-9+/]*={0,2}$/.test(input)) {
    throw new UploadError('Envie somente o conteúdo base64 puro, sem data URI.');
  }
  const estimatedBytes = Math.floor((input.length * 3) / 4);
  if (estimatedBytes > maxBytes + 2) {
    throw new UploadError(`O arquivo excede o limite local de ${maxBytes} bytes.`);
  }
  const bytes = Buffer.from(input, 'base64');
  const canonical = bytes.toString('base64').replace(/=+$/u, '');
  if (canonical !== input.replace(/=+$/u, '')) {
    throw new UploadError('O conteúdo base64 é inválido.');
  }
  return bytes;
}
