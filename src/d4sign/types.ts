export interface Vault {
  uuid: string;
  name: string;
}

export interface DocumentSummary {
  uuid: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  pages: number | null;
  vaultUuid: string | null;
  vaultName: string | null;
  statusId: string | null;
  statusName: string | null;
}

export interface DocumentPage {
  documents: DocumentSummary[];
  page: number;
  totalDocuments: number | null;
  totalPages: number | null;
  hasMore: boolean | null;
}

export interface SignerSummary {
  keySigner: string;
  name: string | null;
  email: string | null;
  signed: boolean;
  authenticationMethod: string | null;
  addedAt: string | null;
}

export interface DocumentSigners {
  documentUuid: string;
  signers: SignerSummary[];
}

export interface DocumentTags {
  documentUuid: string;
  tags: string[];
}

export interface VaultFolder {
  uuid: string;
  vaultUuid: string;
  name: string;
  createdAt: string | null;
}

export interface D4SignTemplate {
  id: string;
  name: string;
  variables: string[];
}

export interface DocumentAttachments {
  documentUuid: string;
  attachments: DocumentSummary[];
  totalAttachments: number;
  totalPages: number | null;
}

export interface SignatureGroup {
  uuid: string;
  name: string;
}

export interface SignatureGroupMember {
  accountUuid: string;
  groupUuid: string;
  email: string;
  signatureTypeId: string | null;
  signatureTypeName: string | null;
  sequence: number | null;
  requiresDigitalCertificate: boolean;
  requiresDocumentAuthentication: boolean;
  requiresDocumentAndSelfie: boolean;
  inPerson: boolean;
  foreign: boolean;
  removed: boolean;
  removalDisabled: boolean;
  editable: boolean;
  uploadAllowed: boolean;
  uploadInstructions: string | null;
  highlightedClause: boolean;
  createdAt: string | null;
}

export interface SignatureGroupDetails {
  vaultUuid: string;
  groupUuid: string;
  name: string;
  members: SignatureGroupMember[];
}

export interface UserVerification {
  email: string;
  status: string;
}

export interface DocumentObserver {
  email: string;
  profile: string;
}

export interface DocumentObservers {
  documentUuid: string;
  observers: DocumentObserver[];
}

export interface DocumentWebhook {
  url: string;
}

export interface DocumentWebhooks {
  documentUuid: string;
  webhooks: DocumentWebhook[];
}

export interface FolderCreated {
  success: true;
  vaultUuid: string;
  folderUuid: string;
  parentFolderUuid: string | null;
  folderName: string;
}

export interface FolderRenamed {
  success: true;
  vaultUuid: string;
  folderUuid: string;
  folderName: string;
}

export interface DocumentTagAdded {
  success: true;
  documentUuid: string;
  tag: string;
}

export interface DocumentObserverAdded {
  success: true;
  documentUuid: string;
  email: string;
  permission: '0' | '1';
}

export interface DocumentSentForSignature {
  success: true;
  documentUuid: string;
  notifySigners: boolean;
  workflow: 'simultaneous' | 'ordered';
  signLimitDate: string | null;
}

export interface DocumentCancelled {
  success: true;
  documentUuid: string;
}

export interface DocumentSignerMutation {
  success: true;
  documentUuid: string;
  email: string;
  keySigner: string;
}

export interface UserBlocked {
  success: true;
  email: string;
}

export interface BatchCreated {
  success: true;
  batchId: string;
  totalDocuments: number;
  documentUuids: string[];
}

export interface DocumentCreatedFromTemplate {
  success: true;
  documentUuid: string;
  vaultUuid: string;
  folderUuid: string | null;
  templateCount: number;
  templateKind: 'html' | 'word';
}

export interface AddedSigner {
  email: string;
  keySigner: string;
  status: string;
}

export interface DocumentSignersAdded {
  success: true;
  documentUuid: string;
  requestedCount: number;
  signers: AddedSigner[];
}

export interface DocumentSignerUpdated {
  success: true;
  documentUuid: string;
  previousEmail: string;
  newEmail: string;
  keySigner: string;
}

export interface DocumentSignerInfoAdded {
  success: true;
  documentUuid: string;
  email: string;
  keySigner: string;
  displayName: string | null;
  status: string;
}

export interface UserUnblocked {
  success: true;
  email: string;
}

export interface DocumentTagRemoved {
  success: true;
  documentUuid: string;
  tag: string;
}

export interface DocumentTagsRemovedAll {
  success: true;
  documentUuid: string;
  removedCount: number;
}

export interface DocumentObserverRemoved {
  success: true;
  documentUuid: string;
  email: string;
}

export interface DocumentObserversRemovedAll {
  success: true;
  documentUuid: string;
  removedCount: number;
}

export interface DocumentUploaded {
  success: true;
  documentUuid: string;
  vaultUuid: string;
  folderUuid: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  processing: true;
}

export interface DocumentAttachmentUploaded {
  success: true;
  mainDocumentUuid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  processing: true;
}

export interface DocumentDownload {
  documentUuid: string;
  name: string;
  url: string;
  type: 'pdf' | 'pdfa' | 'zip';
  language: 'pt' | 'en';
  includesSignerDocuments: boolean;
  includesVideoSelfieFrames: boolean;
}
